import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  assertSame,
  equal,
  hash,
  paymentInput,
  validTransition,
  verifyCallback,
} from "../src/rules";
test("only positive safe integer MMK amounts are accepted", () => {
  assert.deepEqual(paymentInput({ orderId: "order-1", amount: 25000 }), {
    orderId: "order-1",
    amount: 25000,
    description: "",
  });
  for (const amount of [0, -1, 1.5, "100", NaN, Infinity, 100000001])
    assert.throws(() => paymentInput({ orderId: "a", amount }));
  assert.throws(() =>
    paymentInput({ orderId: "a", amount: 100, currency: "USD" }),
  );
  assert.throws(() => paymentInput({ orderId: "../bad", amount: 100 }));
});
test("reusing an order rejects changed amount or description", () => {
  assertSame(
    { amount: "100", description: "Book" },
    { amount: 100, description: "Book" },
  );
  assert.throws(() =>
    assertSame(
      { amount: "100", description: "Book" },
      { amount: 200, description: "Book" },
    ),
  );
  assert.throws(() =>
    assertSame(
      { amount: "100", description: "Book" },
      { amount: 100, description: "Changed" },
    ),
  );
});
test("late events cannot downgrade paid or terminal payments", () => {
  assert.equal(validTransition("PENDING", "SUCCESS"), true);
  assert.equal(validTransition("SUCCESS", "PENDING"), false);
  assert.equal(validTransition("SUCCESS", "FAILED"), false);
  assert.equal(validTransition("SUCCESS", "REFUNDED"), true);
  assert.equal(validTransition("EXPIRED", "PENDING"), false);
  assert.equal(validTransition("PENDING", "unexpected"), false);
});
test("callback HMAC authenticates exact bytes and rejects tampering", () => {
  const body = '{"orderId":"order-1","amount":100}',
    nonce = "1730000000000",
    secret = "test-secret";
  const signature = createHmac("sha256", secret)
    .update(`${nonce}.${body}`)
    .digest("hex");
  assert.equal(verifyCallback(body, nonce, signature, secret), true);
  assert.equal(verifyCallback(body + " ", nonce, signature, secret), false);
  assert.equal(verifyCallback(body, nonce, signature, "wrong"), false);
  assert.equal(verifyCallback(body, "", signature, secret), false);
  assert.equal(verifyCallback(body, nonce, "invalid", secret), false);
  assert.equal(equal("abc", "abc"), true);
  assert.equal(equal("abc", "def"), false);
  assert.equal(hash("a").length, 64);
});

import { publicHttpsOrigin } from "../src/rules";
test("placeholder origins never pass production setup checks", () => {
  for (const origin of [
    undefined,
    "https://payments.your-domain.com",
    "https://example.com",
    "http://payments.real-merchant.com",
    "https://127.0.0.1",
    "https://pay.test",
    "https://user:password@payments.real-merchant.com",
    "https://payments.real-merchant.com/path",
  ])
    assert.equal(publicHttpsOrigin(origin), false);
  assert.equal(publicHttpsOrigin("https://payments.real-merchant.com"), true);
});
