import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { MMPaySDK } from "mmpay-node-sdk";
// MyanMyanPay accepts at most 32 characters; retain the complete UUID without hyphens.
export function providerReference(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new BadRequestException("Invalid payment identifier");
  return id.replace(/-/g, "").toLowerCase();
}
export function gatewayReference(id: string) {
  if (/^[0-9a-f]{32}$/i.test(id))
    return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`.toLowerCase();
  providerReference(id);
  return id.toLowerCase();
}
export function provider() {
  const {
    MMPAY_APP_ID: appId,
    MMPAY_PUBLISHABLE_KEY: publishableKey,
    MMPAY_SECRET_KEY: secretKey,
    MMPAY_API_BASE_URL: apiBaseUrl,
  } = process.env;
  if (
    !appId ||
    !publishableKey ||
    !secretKey ||
    !apiBaseUrl ||
    !process.env.PUBLIC_API_URL
  )
    throw new ServiceUnavailableException(
      "Configure MyanMyanPay credentials and PUBLIC_API_URL first",
    );
  return MMPaySDK({ appId, publishableKey, secretKey, apiBaseUrl });
}
export async function upstream<T>(operation: () => Promise<T>): Promise<T> {
  // shortcut: the SDK cannot abort requests; replace the adapter if sustained upstream timeouts occur.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Provider timeout")), 15000);
      }),
    ]);
    if (
      !result ||
      result instanceof Error ||
      typeof result !== "object" ||
      !("orderId" in result)
    )
      throw new Error("Invalid provider response");
    return result;
  } catch {
    throw new ServiceUnavailableException(
      "Provider request failed. Reconcile this order before retrying.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export function providerMode(): "sandbox" | "live" | "unconfigured" {
  if (
    !process.env.MMPAY_APP_ID ||
    !process.env.MMPAY_PUBLISHABLE_KEY ||
    !process.env.MMPAY_SECRET_KEY ||
    !process.env.MMPAY_API_BASE_URL
  )
    return "unconfigured";
  return process.env.MMPAY_PUBLISHABLE_KEY.includes("_test_") ||
    process.env.MMPAY_SECRET_KEY.includes("_test_")
    ? "sandbox"
    : "live";
}
