import { BadRequestException } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request } from "node:https";
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["64:ff9b::", 96],
  ["2002::", 16],
  ["2001::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");
export function publicAddress(address: string, family: number) {
  return (
    isIP(address) === family &&
    !(family === 6 && address.toLowerCase().startsWith("::ffff:")) &&
    !blocked.check(address, family === 6 ? "ipv6" : "ipv4")
  );
}
export function validateWebhookUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2048)
    throw new BadRequestException("Invalid webhook URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException("Invalid webhook URL");
  }
  const allowed = (process.env.WEBHOOK_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !allowed.includes(url.hostname.toLowerCase())
  )
    throw new BadRequestException(
      "Use an HTTPS webhook on a hostname listed in WEBHOOK_ALLOWED_HOSTS",
    );
  return url.toString();
}
function encryptionKey() {
  const secret = process.env.WEBHOOK_ENCRYPTION_KEY;
  if (!secret || secret.length < 32 || secret.startsWith("replace-"))
    throw new BadRequestException(
      "Set WEBHOOK_ENCRYPTION_KEY (32+ characters) before enabling webhooks",
    );
  return createHash("sha256").update(secret).digest();
}
export function seal(secret: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  return [
    iv.toString("hex"),
    Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]).toString(
      "hex",
    ),
    cipher.getAuthTag().toString("hex"),
  ].join(".");
}
export function unseal(value: string) {
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
export function deliverySignature(
  secret: string,
  timestamp: string,
  payload: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
}
async function webhookAddresses(url: URL) {
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  let addresses: Awaited<ReturnType<typeof lookup>>[];
  try {
    addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => {
        dnsTimer = setTimeout(() => reject(new Error("DNS timeout")), 5000);
      }),
    ]);
  } catch {
    throw new BadRequestException("Cannot resolve webhook hostname. Check the URL and try again.");
  } finally {
    clearTimeout(dnsTimer);
  }
  if (
    !addresses.length ||
    addresses.some((a) => !publicAddress(a.address, a.family))
  )
    throw new BadRequestException("Webhook must resolve only to public internet addresses. Private and local addresses are blocked.");
  return addresses;
}
export async function approveWebhookUrl(value: unknown) {
  const url = validateWebhookUrl(value);
  await webhookAddresses(new URL(url));
  return url;
}
export async function sendWebhook(
  urlValue: string,
  encryptedSecret: string,
  payload: string,
  id: string,
): Promise<number> {
  const url = new URL(validateWebhookUrl(urlValue));
  const addresses = await webhookAddresses(url);
  const address = addresses[0],
    timestamp = Math.floor(Date.now() / 1000).toString();
  return new Promise((resolve, reject) => {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const req = request(
      url,
      {
        method: "POST",
        family: address.family,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "Byle-Event-Id": id,
          "Byle-Timestamp": timestamp,
          "Byle-Signature": deliverySignature(
            unseal(encryptedSecret),
            timestamp,
            payload,
          ),
        },
        lookup: (_hostname, _options, callback) =>
          callback(null, address.address, address.family),
      },
      (res) => {
        clearTimeout(deadline);
        const status = res.statusCode || 0;
        res.destroy();
        resolve(status);
      },
    );
    deadline = setTimeout(
      () => req.destroy(new Error("Webhook timeout")),
      10000,
    );
    req.on("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    req.end(payload);
  });
}
