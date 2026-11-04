import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  publicAddress,
  validateWebhookUrl,
  approveWebhookUrl,
  seal,
  unseal,
  deliverySignature,
} from "../src/webhooks";
test("webhook URLs require approved HTTPS destinations", () => {
  process.env.WEBHOOK_ALLOWED_HOSTS = "payments.example.com";
  assert.equal(
    validateWebhookUrl("https://payments.example.com/webhook"),
    "https://payments.example.com/webhook",
  );
  for (const url of [
    "http://payments.example.com",
    "https://unapproved.example.com",
    "https://user:pass@payments.example.com",
    "https://payments.example.com:8443",
    "https://payments.example.com/#secret",
    "file:///etc/passwd",
  ])
    assert.throws(() => validateWebhookUrl(url));
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.0.1",
    "100.64.0.1",
    "0.0.0.0",
  ])
    assert.equal(publicAddress(address, 4), false);
  for (const address of [
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "64:ff9b::a00:1",
  ])
    assert.equal(publicAddress(address, 6), false);
  assert.equal(publicAddress("8.8.8.8", 4), true);
});
test("saving an approved webhook rejects unsafe or unavailable DNS", async (t) => {
  const previous = process.env.WEBHOOK_ALLOWED_HOSTS;
  t.after(() => {
    if (previous === undefined) delete process.env.WEBHOOK_ALLOWED_HOSTS;
    else process.env.WEBHOOK_ALLOWED_HOSTS = previous;
  });
  process.env.WEBHOOK_ALLOWED_HOSTS = "mystore-beryl.vercel.app";
  const dns = (await import("node:dns/promises")).default;
  const url = "https://mystore-beryl.vercel.app/webhooks/byle";
  t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  assert.equal(await approveWebhookUrl(url), url);
  for (const invalid of ["http://store.example/webhook", "https://store.example:8443", "https://user:pass@store.example", "https://store.example/#secret"])
    await assert.rejects(() => approveWebhookUrl(invalid));
  for (const addresses of [[], [{ address: "127.0.0.1", family: 4 }], [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }], [{ address: "::1", family: 6 }]]) {
    t.mock.method(dns, "lookup", async () => addresses);
    await assert.rejects(() => approveWebhookUrl(url));
  }
  t.mock.method(dns, "lookup", async () => { throw new Error("ENOTFOUND"); });
  await assert.rejects(() => approveWebhookUrl(url), /Cannot resolve/);
});
test("webhook secrets are authenticated encrypted and signatures cover exact bytes", () => {
  process.env.WEBHOOK_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const secret = "whsec_test",
    a = seal(secret),
    b = seal(secret);
  assert.notEqual(a, b);
  assert.ok(!a.includes(secret));
  assert.equal(unseal(a), secret);
  const parts = a.split(".");
  parts[2] = (parts[2][0] === "0" ? "1" : "0") + parts[2].slice(1);
  assert.throws(() => unseal(parts.join(".")));
  assert.notEqual(
    deliverySignature(secret, "123", "{}"),
    deliverySignature(secret, "123", "{ }"),
  );
  assert.notEqual(
    deliverySignature(secret, "123", "{}"),
    deliverySignature(secret, "124", "{}"),
  );
});

test("outgoing sender pins vetted DNS and signs the exact body", async (t) => {
  const dns = (await import("node:dns/promises")).default;
  const https = (await import("node:https")).default;
  const { EventEmitter } = await import("node:events");
  const { sendWebhook } = await import("../src/webhooks");
  process.env.WEBHOOK_ALLOWED_HOSTS = "payments.example.com";
  process.env.WEBHOOK_ENCRYPTION_KEY = randomBytes(32).toString("hex");
  t.mock.method(dns, "lookup", async () => [{ address: "8.8.8.8", family: 4 }]);
  const secret = "whsec_sender_check",
    payload = '{"id":"event-1","type":"payment.status_changed"}';
  let requests = 0;
  t.mock.method(
    https,
    "request",
    (
      url: URL,
      options: Record<string, any>,
      callback: (res: unknown) => void,
    ) => {
      requests++;
      assert.equal(url.hostname, "payments.example.com");
      assert.equal(options.family, 4);
      assert.equal(options.rejectUnauthorized, undefined);
      assert.equal(options.headers["Byle-Event-Id"], "event-1");
      assert.equal(
        options.headers["Byle-Signature"],
        deliverySignature(secret, options.headers["Byle-Timestamp"], payload),
      );
      options.lookup(
        url.hostname,
        {},
        (error: unknown, address: string, family: number) => {
          assert.equal(error, null);
          assert.equal(address, "8.8.8.8");
          assert.equal(family, 4);
        },
      );
      const req = Object.assign(new EventEmitter(), {
        setTimeout: () => req,
        destroy: () => req,
        end: (body: string) => {
          assert.equal(body, payload);
          callback({ statusCode: 204, destroy: () => {} });
          return req;
        },
      });
      return req;
    },
  );
  assert.equal(
    await sendWebhook(
      "https://payments.example.com/events",
      seal(secret),
      payload,
      "event-1",
    ),
    204,
  );
  assert.equal(requests, 1);
  t.mock.method(dns, "lookup", async () => [
    { address: "127.0.0.1", family: 4 },
  ]);
  await assert.rejects(() =>
    sendWebhook(
      "https://payments.example.com/events",
      seal(secret),
      payload,
      "event-1",
    ),
  );
  assert.equal(requests, 1);
});
