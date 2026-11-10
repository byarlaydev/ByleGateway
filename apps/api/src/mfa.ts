import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import * as OTPAuth from "otpauth";
import { db } from "./db";
import { auditLog } from "./audit";

function encryptionKey() {
  const secret = process.env.MFA_ENCRYPTION_KEY;
  if (!secret || secret.length < 32 || secret.startsWith("replace-"))
    throw new BadRequestException(
      "Set MFA_ENCRYPTION_KEY (32+ characters) before enabling MFA",
    );
  return createHash("sha256").update(secret).digest();
}
function seal(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return [
    iv.toString("hex"),
    Buffer.concat([cipher.update(value, "utf8"), cipher.final()]).toString(
      "hex",
    ),
    cipher.getAuthTag().toString("hex"),
  ].join(".");
}
function unseal(value: string) {
  const [iv, body, tag] = value.split(".");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "hex"),
  );
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([
    cipher.update(Buffer.from(body, "hex")),
    cipher.final(),
  ]).toString("utf8");
}
function authenticator(secret: string) {
  return new OTPAuth.TOTP({
    issuer: "Byle Gateway",
    label: "Owner",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
function counterFor(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator(secret).validate({ token: code, window: 1, timestamp: now });
  return delta === null ? null : Math.floor(now / 30000) + delta;
}
function hashRecoveryCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}
function normalizedCode(code: string) {
  return code.replace(/[\s-]/g, "").toLowerCase();
}
function freshRecovery() {
  const codes = Array.from({ length: 8 }, () => randomBytes(16).toString("hex"));
  return {
    codes: codes.map((c) => c.match(/.{8}/g)!.join("-")),
    hashes: codes.map(hashRecoveryCode),
  };
}
async function state() {
  const { rows: [row] } = await db.query(
    "SELECT * FROM owner_mfa WHERE id='owner'",
  );
  return row as {
    enabled: boolean;
    secret: string | null;
    pending: string | null;
    pending_until: Date | null;
    recovery: string[];
    last_counter: number;
    failed_attempts: number;
    blocked_until: Date;
    version: number;
  };
}
export async function mfaStatus() {
  const row = await state();
  return {
    enabled: row.enabled,
    configured:
      Boolean(process.env.MFA_ENCRYPTION_KEY) &&
      process.env.MFA_ENCRYPTION_KEY!.length >= 32 &&
      !process.env.MFA_ENCRYPTION_KEY!.startsWith("replace-"),
    recoveryRemaining: row.recovery.length,
  };
}
async function consumeFactor(row: Awaited<ReturnType<typeof state>>, code: string, now = Date.now()) {
  if (new Date(row.blocked_until).getTime() > now) return false;
  const value = normalizedCode(code);
  const digest = hashRecoveryCode(value);
  const recoveryIndex = /^[a-f0-9]{32}$/.test(value)
    ? row.recovery.findIndex((c) =>
        timingSafeEqual(Buffer.from(c, "hex"), Buffer.from(digest, "hex")),
      )
    : -1;
  if (recoveryIndex >= 0) {
    const codes = [...row.recovery];
    codes.splice(recoveryIndex, 1);
    await db.query(
      "UPDATE owner_mfa SET recovery=$1,failed_attempts=0,blocked_until='epoch' WHERE id='owner'",
      [JSON.stringify(codes)],
    );
    await auditLog("mfa.recovery_code_used");
    return true;
  }
  let counter: number | null = null;
  try {
    counter = row.secret ? counterFor(unseal(row.secret), value, now) : null;
  } catch {}
  if (counter !== null && counter > row.last_counter) {
    await db.query(
      "UPDATE owner_mfa SET last_counter=$1,failed_attempts=0,blocked_until='epoch' WHERE id='owner'",
      [counter],
    );
    return true;
  }
  const failures =
    new Date(row.blocked_until).getTime() <= now ? 1 : row.failed_attempts + 1;
  await db.query(
    "UPDATE owner_mfa SET failed_attempts=$1,blocked_until=$2 WHERE id='owner'",
    [failures, failures >= 5 ? new Date(now + 60000) : new Date(0)],
  );
  return false;
}
export async function verifyOwnerMfa(code: unknown) {
  const row = await state();
  if (!row.enabled) return true;
  if (typeof code !== "string" || !code.trim() || code.length > 100)
    return false;
  return consumeFactor(row, code);
}
export async function beginMfa() {
  encryptionKey();
  const row = await state();
  if (row.enabled) throw new BadRequestException("MFA is already enabled.");
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await db.query(
    "UPDATE owner_mfa SET pending=$1,pending_until=now()+interval '10 minutes' WHERE id='owner'",
    [seal(secret)],
  );
  return { secret, uri: authenticator(secret).toString() };
}
export async function enableMfa(code: unknown) {
  if (typeof code !== "string" || code.length > 100)
    throw new BadRequestException("Enter your authenticator code.");
  const row = await state();
  if (row.enabled || !row.pending || !row.pending_until || new Date(row.pending_until).getTime() < Date.now())
    throw new BadRequestException("Setup expired. Start again.");
  if (new Date(row.blocked_until).getTime() > Date.now())
    throw new UnauthorizedException("Wait a minute before trying again.");
  const secret = unseal(row.pending);
  const counter = counterFor(secret, normalizedCode(code));
  if (counter === null) {
    const failures = row.failed_attempts + 1;
    await db.query(
      "UPDATE owner_mfa SET failed_attempts=$1,blocked_until=$2 WHERE id='owner'",
      [failures, failures >= 5 ? new Date(Date.now() + 60000) : new Date(0)],
    );
    throw new UnauthorizedException("Invalid authenticator code.");
  }
  const recovery = freshRecovery();
  await db.query(
    "UPDATE owner_mfa SET enabled=true,secret=pending,pending=NULL,pending_until=NULL,last_counter=$1,recovery=$2,version=version+1,failed_attempts=0,blocked_until='epoch' WHERE id='owner'",
    [counter, JSON.stringify(recovery.hashes)],
  );
  await auditLog("mfa.enabled");
  return { codes: recovery.codes };
}
export async function changeMfa(
  action: "disable" | "recovery",
  code: unknown,
) {
  if (typeof code !== "string" || code.length > 100)
    throw new BadRequestException("Enter your authenticator or recovery code.");
  const row = await state();
  if (!row.enabled || !(await consumeFactor(row, code)))
    throw new UnauthorizedException("Invalid authenticator or recovery code.");
  const recovery = action === "recovery" ? freshRecovery() : { codes: [], hashes: [] };
  await db.query(
    "UPDATE owner_mfa SET enabled=$1,secret=$2,recovery=$3,version=version+1 WHERE id='owner'",
    [
      action === "disable" ? false : true,
      action === "disable" ? null : row.secret,
      JSON.stringify(recovery.hashes),
    ],
  );
  await auditLog(action === "disable" ? "mfa.disabled" : "mfa.recovery_regenerated");
  return { codes: recovery.codes };
}
