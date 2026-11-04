import assert from "node:assert/strict";
import test from "node:test";
import { checkoutRemaining } from "../apps/web/lib/checkout-window";

test("QR countdown lasts fifteen minutes and never resets after reload or expiry", () => {
  const start = Date.parse("2026-11-04T00:00:00Z");
  const end = new Date(start + 900_000).toISOString();
  assert.equal(checkoutRemaining(end, start), 900);
  assert.equal(checkoutRemaining(end, start + 60_000), 840);
  assert.equal(checkoutRemaining(end, start + 899_500), 1);
  assert.equal(checkoutRemaining(end, start + 900_000), 0);
  assert.equal(checkoutRemaining(end, start + 901_000), 0);
  assert.equal(checkoutRemaining("invalid", start), 0);
});
