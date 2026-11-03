import { createHmac, timingSafeEqual } from "node:crypto";
export const sessionCookie = "byle_session";
export function credentialVersion() {
  const password = process.env.OWNER_PASSWORD,
    token = process.env.OWNER_TOKEN;
  if (
    !password ||
    password.length < 16 ||
    password.startsWith("replace-") ||
    !token ||
    token.length < 32 ||
    token.startsWith("replace-")
  )
    throw new Error(
      "Configure a strong OWNER_PASSWORD and OWNER_TOKEN on the server.",
    );
  return createHmac("sha256", token).update(password).digest("hex");
}
export function passwordMatches(password: unknown) {
  if (typeof password !== "string") return false;
  const version = credentialVersion();
  const candidate = createHmac("sha256", process.env.OWNER_TOKEN!)
    .update(password)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(version, "hex"),
    Buffer.from(candidate, "hex"),
  );
}
export async function sessionRequest(method: string, token?: string) {
  const version = credentialVersion();
  return fetch(
    `${process.env.API_ORIGIN || "http://127.0.0.1:4000"}/admin/sessions${method === "POST" ? "" : "/current"}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${process.env.OWNER_TOKEN}`,
        "Content-Type": "application/json",
        "X-Owner-Session": token || "",
        "X-Credential-Version": version,
      },
      body:
        method === "POST"
          ? JSON.stringify({ credentialVersion: version })
          : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );
}
export async function authenticated(token?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const response = await sessionRequest("GET", token);
  if (response.status === 401) return false;
  if (!response.ok)
    throw new Error(
      "The gateway API is unavailable. Check the API and PostgreSQL services.",
    );
  return true;
}
// shortcut: login throttling is per process; use a shared limiter before deploying multiple web replicas.
export class LoginLimiter {
  private clients = new Map<string, { failures: number; expires: number }>();
  blocked(client: string, now = Date.now()) {
    const bucket = this.clients.get(client);
    return Boolean(bucket && bucket.expires > now && bucket.failures >= 10);
  }
  failed(client: string, now = Date.now()) {
    for (const [key, bucket] of this.clients)
      if (bucket.expires <= now) this.clients.delete(key);
    if (this.clients.size >= 10000 && !this.clients.has(client))
      this.clients.delete(this.clients.keys().next().value!);
    const bucket = this.clients.get(client);
    this.clients.set(
      client,
      bucket && bucket.expires > now
        ? { ...bucket, failures: bucket.failures + 1 }
        : { failures: 1, expires: now + 60000 },
    );
  }
  succeeded(client: string) {
    this.clients.delete(client);
  }
}
