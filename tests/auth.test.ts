import test from "node:test";
import assert from "node:assert/strict";
import {
  LoginLimiter,
  credentialVersion,
  passwordMatches,
  authenticated,
} from "../apps/web/lib/auth";
test("one address cannot exhaust another address login allowance", () => {
  const limiter = new LoginLimiter();
  for (let n = 0; n < 10; n++) limiter.failed("address-a", 1000);
  assert.equal(limiter.blocked("address-a", 1001), true);
  assert.equal(limiter.blocked("address-b", 1001), false);
  assert.equal(limiter.blocked("address-a", 61001), false);
  limiter.succeeded("address-a");
  assert.equal(limiter.blocked("address-a", 1001), false);
});
test("password changes create a new session credential revision", () => {
  process.env.OWNER_TOKEN = "a".repeat(64);
  process.env.OWNER_PASSWORD = "a-long-test-owner-password";
  assert.equal(passwordMatches(process.env.OWNER_PASSWORD), true);
  assert.equal(passwordMatches("wrong"), false);
  assert.equal(passwordMatches(null), false);
  const revision = credentialVersion();
  process.env.OWNER_PASSWORD = "a-different-long-owner-password";
  assert.notEqual(credentialVersion(), revision);
  process.env.OWNER_PASSWORD = "short";
  assert.throws(() => credentialVersion());
});
test("legacy and malformed session cookies are rejected before a request", async () => {
  assert.equal(await authenticated("1730000000000." + "a".repeat(64)), false);
  assert.equal(await authenticated("é".repeat(64)), false);
  assert.equal(await authenticated(), false);
});
