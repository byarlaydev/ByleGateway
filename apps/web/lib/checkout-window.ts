export const checkoutWindowSeconds = 15 * 60;

export function checkoutRemaining(expiresAt: string, now: number) {
  const remaining = Math.ceil((Date.parse(expiresAt) - now) / 1000);
  return Number.isFinite(remaining)
    ? Math.max(0, Math.min(checkoutWindowSeconds, remaining))
    : 0;
}
