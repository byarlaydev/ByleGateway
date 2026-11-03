import { BadRequestException, ConflictException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
export const hash = (key: string) =>
  createHash("sha256").update(key).digest("hex");
export const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
export function paymentInput(body: Record<string, unknown>) {
  if (
    !body ||
    typeof body.orderId !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,100}$/.test(body.orderId)
  )
    throw new BadRequestException(
      "orderId must be 1–100 letters, numbers, dots, underscores or hyphens",
    );
  if (
    !Number.isSafeInteger(body.amount) ||
    Number(body.amount) < 1 ||
    Number(body.amount) > 100000000
  )
    throw new BadRequestException(
      "amount must be an integer from 1 to 100000000 MMK",
    );
  if (body.currency !== undefined && body.currency !== "MMK")
    throw new BadRequestException("Only MMK is supported");
  if (
    body.description !== undefined &&
    (typeof body.description !== "string" || body.description.length > 200)
  )
    throw new BadRequestException("description must be at most 200 characters");
  return {
    orderId: body.orderId,
    amount: body.amount as number,
    description: (body.description || "") as string,
  };
}
export function assertSame(
  existing: { amount: string; description: string },
  input: { amount: number; description: string },
) {
  if (
    Number(existing.amount) !== input.amount ||
    existing.description !== input.description
  )
    throw new ConflictException(
      "orderId already exists with different payment details",
    );
}
export function validTransition(from: string, to: string) {
  if (from === to) return true;
  if (["CREATING", "PENDING"].includes(from))
    return ["PENDING", "SUCCESS", "FAILED", "EXPIRED", "CANCELLED"].includes(
      to,
    );
  return from === "SUCCESS" && to === "REFUNDED";
}

export function verifyCallback(
  payload: string,
  nonce: string,
  signature: string,
  secret: string,
) {
  if (!secret || !nonce || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret)
    .update(`${nonce}.${payload}`)
    .digest("hex");
  return equal(signature, expected);
}

export function publicHttpsOrigin(value: string | undefined) {
  try {
    const url = new URL(value || ""),
      host = url.hostname.toLowerCase();
    const placeholders = [
      "example.com",
      "example.org",
      "example.net",
      "your-domain.com",
    ];
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      host.includes(".") &&
      !/\.(local|localhost|test|invalid)$/.test(host) &&
      !placeholders.some(
        (domain) => host === domain || host.endsWith("." + domain),
      ) &&
      !/^[\d.]+$/.test(host) &&
      !host.startsWith("[")
    );
  } catch {
    return false;
  }
}
