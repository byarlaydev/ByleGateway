const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");
const { resolve } = require("node:path");
require("dotenv").config({ path: resolve(__dirname, "../.env"), quiet: true });
(async () => {
  const base = "http://127.0.0.1:3000";
  let appId;
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const entry = await fetch(base + "/", { redirect: "manual" });
    assert.equal(entry.status, 307);
    assert.ok(entry.headers.get("location").endsWith("/login"));
    const loginPage = await fetch(base + "/login");
    const html = await loginPage.text();
    assert.equal(loginPage.status, 200);
    assert.ok(html.includes("Sign in to your gateway."));
    assert.ok(!html.includes("BG-1048"));
    assert.ok(!html.includes("demo"));
    assert.equal((await fetch(base + "/api/admin/overview")).status, 401);
    assert.equal(
      (
        await fetch(base + "/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: process.env.OWNER_PASSWORD }),
        })
      ).status,
      403,
    );
    const login = await fetch(base + "/api/session", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ password: process.env.OWNER_PASSWORD }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const overview = await fetch(base + "/api/admin/overview", {
      headers: { Cookie: cookie },
    });
    assert.equal(overview.status, 200);
    assert.equal(typeof (await overview.json()).configured, "boolean");
    const app = await fetch(base + "/api/admin/apps", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "Proxy verification " + randomUUID() }),
    });
    assert.equal(app.status, 201);
    const data = await app.json();
    appId = data.id;
    assert.ok(data.key.startsWith("bg_"));
    const setup = await fetch(base + "/api/admin/setup", {
      headers: { Cookie: cookie },
    });
    assert.equal(setup.status, 200);
    assert.equal((await setup.json()).database, true);
    const report = await fetch(
      base + `/api/admin/overview?app=${appId}&limit=1`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(report.status, 200);
    assert.equal((await report.json()).limit, 1);
    const rotated = await fetch(base + `/api/admin/apps/${appId}/rotate-key`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: base },
    });
    assert.equal(rotated.status, 201);
    assert.equal((await rotated.json()).id, appId);
    const csv = await fetch(base + `/api/admin/payments/export?app=${appId}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(csv.status, 200);
    assert.ok(csv.headers.get("content-type").includes("text/csv"));
    assert.ok((await csv.text()).startsWith("Order,Application"));
    const publicCheckout = await fetch(
      base + "/api/checkout/" + "a".repeat(64),
    );
    assert.equal(publicCheckout.status, 404);
    const revoke = await fetch(base + `/api/admin/apps/${appId}/key`, {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: base },
    });
    assert.equal(revoke.status, 200);
    const logout = await fetch(base + "/api/session", {
      method: "DELETE",
      headers: { Cookie: cookie, Origin: base },
    });
    assert.equal(logout.status, 200);
    const replay = await fetch(base + "/api/admin/overview", {
      headers: { Cookie: cookie },
    });
    assert.equal(
      replay.status,
      401,
      "logged-out sessions must not be reusable",
    );
    const legacy = await fetch(base + "/api/session", {
      headers: { Cookie: "byle_session=1730000000000." + "a".repeat(64) },
    });
    assert.equal((await legacy.json()).authenticated, false);
    const role = await db.query(
      "SELECT rolsuper,rolcreatedb,rolcreaterole,has_schema_privilege(current_user,'public','CREATE') AS can_create FROM pg_roles WHERE rolname=current_user",
    );
    assert.deepEqual(role.rows[0], {
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      can_create: false,
    });
    console.log(
      "Next.js proxy check passed: unauthorized access, CSRF rejection, owner login, database overview, app registration, rotation, query filters, CSV streaming, public checkout routing, setup checks, revocation, logout replay rejection, authenticated entry, and restricted database privileges.",
    );
  } finally {
    if (appId) await db.query("DELETE FROM apps WHERE id=$1", [appId]);
    await db.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
