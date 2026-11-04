import assert from "node:assert/strict";
import test from "node:test";
import { integrationPrompt } from "../apps/web/lib/integration-prompt";

test("agent prompt uses the deployment origin and contains the integration contract without credentials", () => {
  const prompt = integrationPrompt("https://gateway.example.org/integration");
  assert.ok(prompt.includes("GATEWAY_URL=https://gateway.example.org\n"));
  for (const contract of [
    "POST /v1/payments",
    "GET /v1/payments/:id",
    "raw body bytes",
    "constant time",
    "300 seconds",
    "unique constraint",
    "order_id",
    "orderId",
    "REFUNDED",
    "merchant sandbox",
    "PAYMENT POWERED BY MYANMYANPAY",
    "Download QR",
    "15-minute countdown",
    "unmodified MyanmarPay MMQR logo",
  ])
    assert.ok(prompt.includes(contract), contract);
  assert.ok(!/bg_[a-f0-9]{32,}|whsec_[a-f0-9]{32,}|OWNER_TOKEN/.test(prompt));
});
