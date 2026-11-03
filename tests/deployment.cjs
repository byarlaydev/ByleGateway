const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
require("dotenv").config({ quiet: true });
const env = {
  ...process.env,
  POSTGRES_PASSWORD:
    process.env.POSTGRES_PASSWORD || "configuration_check_only",
  DASHBOARD_HOST: process.env.DASHBOARD_HOST || "gateway.example.com",
  PUBLIC_API_HOST: process.env.PUBLIC_API_HOST || "payments.example.com",
};
const config = JSON.parse(
  execFileSync(
    "docker",
    ["compose", "-f", "compose.production.yaml", "config", "--format", "json"],
    { env, encoding: "utf8" },
  ),
);
const web = config.services.web.environment,
  migration = config.services.migrate.environment,
  api = config.services.api.environment;
assert.deepEqual(Object.keys(web).sort(), [
  "API_ORIGIN",
  "OWNER_PASSWORD",
  "OWNER_TOKEN",
  "TRUST_PROXY",
]);
assert.deepEqual(Object.keys(migration).sort(), [
  "MIGRATION_DATABASE_URL",
  "RUNTIME_DATABASE_PASSWORD",
]);
assert.ok(api.DATABASE_URL.startsWith("postgresql://byle_app:"));
assert.ok(!("MIGRATION_DATABASE_URL" in api));
assert.ok(!("OWNER_PASSWORD" in api));
assert.ok(!config.services.postgres.ports);
assert.ok(!config.services.api.ports);
assert.ok(!config.services.web.ports);
console.log(
  "Deployment isolation passed: explicit service secrets, restricted runtime role, private application/database ports.",
);
