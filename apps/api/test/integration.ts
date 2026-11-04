import { providerReference } from "../src/provider";
import { createServer } from "node:http";
import { createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { db, schema } from "../src/db";
import { tick } from "../src/worker";
import { unseal, deliverySignature } from "../src/webhooks";

async function run() {
  const migrationUrl =
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const adminDb = new Pool({ connectionString: migrationUrl });
  db.options.connectionString = migrationUrl;
  const namespace = "byle_test_" + randomBytes(8).toString("hex");
  await adminDb.query(`CREATE SCHEMA ${namespace}`);
  db.options.options = `-c search_path=${namespace}`;
  await db.query(schema);
  const databaseUrl = new URL(migrationUrl!);
  databaseUrl.searchParams.set("options", `-c search_path=${namespace}`);
  const secret = randomBytes(32).toString("hex");
  const owner = randomBytes(32).toString("hex");
  const encryption = randomBytes(32).toString("hex");
  Object.assign(process.env, {
    MMPAY_APP_ID: "integration",
    MMPAY_PUBLISHABLE_KEY: "pk_test_integration",
    MMPAY_SECRET_KEY: secret,
    MMPAY_API_BASE_URL: "http://127.0.0.1:4401",
    PUBLIC_API_URL: "http://127.0.0.1:4402",
    WEBHOOK_ENCRYPTION_KEY: encryption,
    WEBHOOK_ALLOWED_HOSTS: "payments.example.com",
  });
  const records = new Map<
    string,
    {
      orderId: string;
      amount: number;
      status: string;
      currency: string;
      qr: string;
    }
  >();
  let creates = 0;
  const appIds: string[] = [];
  const mock = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const signature = createHmac("sha256", secret)
      .update(`${req.headers["x-mmpay-nonce"]}.${raw}`)
      .digest("hex");
    if (signature !== req.headers["x-mmpay-signature"]) {
      res.writeHead(401).end();
      return;
    }
    const body = JSON.parse(raw);
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("sandbox-handshake")) {
      res.end(JSON.stringify({ token: "integration-token" }));
      return;
    }
    if (req.url?.endsWith("sandbox-create")) {
      creates++;
      const record = {
        orderId: body.orderId,
        amount: body.amount,
        status: "PENDING",
        currency: "MMK",
        qr: "TEST-EMVCO-NOT-A-REAL-PAYMENT",
      };
      assert.match(body.orderId, /^[a-f0-9]{32}$/);
      records.set(body.orderId, record);
      res.end(JSON.stringify(record));
      return;
    }
    const record = records.get(body.orderId);
    if (!record) {
      res.writeHead(404).end("{}");
      return;
    }
    res.end(JSON.stringify(record));
  });
  await new Promise<void>((resolve) => mock.listen(4401, "127.0.0.1", resolve));
  const server = spawn(
    process.execPath,
    ["--require", resolve(__dirname, "public-dns.cjs"), resolve(__dirname, "../dist/main.js")],
    {
      env: {
        ...process.env,
        PORT: "4402",
        DATABASE_URL: databaseUrl.toString(),
        WORKER_ENABLED: "false",
        CHECKOUT_ORIGIN: "http://127.0.0.1:3000",
        WEBHOOK_ALLOWED_HOSTS: "payments.example.com",
        WEBHOOK_ENCRYPTION_KEY: encryption,
        OWNER_TOKEN: owner,
        MMPAY_APP_ID: "integration",
        MMPAY_PUBLISHABLE_KEY: "pk_test_integration",
        MMPAY_SECRET_KEY: secret,
        MMPAY_API_BASE_URL: "http://127.0.0.1:4401",
        PUBLIC_API_URL: "http://127.0.0.1:4402",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  server.stdout.on("data", (c) => (logs += c));
  server.stderr.on("data", (c) => (logs += c));
  const request = async (
    path: string,
    key = owner,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const response = await fetch(`http://127.0.0.1:4402${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await request("/health")).status === 200) break;
      } catch {}
      if (attempt === 49) throw new Error("API did not start: " + logs);
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal((await request("/admin/overview", "invalid")).status, 401);
    const revision = randomBytes(32).toString("hex");
    const session = await request("/admin/sessions", owner, "POST", {
      credentialVersion: revision,
    });
    assert.equal(session.status, 201);
    const sessionHeaders = {
      "x-owner-session": session.body.token,
      "x-credential-version": revision,
    };
    assert.equal(
      (
        await request(
          "/admin/sessions/current",
          owner,
          "GET",
          undefined,
          sessionHeaders,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/admin/sessions/current", owner, "GET", undefined, {
          ...sessionHeaders,
          "x-credential-version": "0".repeat(64),
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await request(
          "/admin/sessions/current",
          owner,
          "DELETE",
          undefined,
          sessionHeaders,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/admin/sessions/current",
          owner,
          "GET",
          undefined,
          sessionHeaders,
        )
      ).status,
      401,
    );
    const a = await request("/admin/apps", owner, "POST", {
      name: "Integration check A",
    });
    assert.equal(a.status, 201);
    appIds.push(a.body.id);
    const b = await request("/admin/apps", owner, "POST", {
      name: "Integration check B",
    });
    assert.equal(b.status, 201);
    appIds.push(b.body.id);
    const input = {
      orderId: "integration-order",
      amount: 25000,
      description: "Self-check",
    };
    const duplicate = await Promise.all(
      Array.from({ length: 4 }, () =>
        request("/v1/payments", a.body.key, "POST", input),
      ),
    );
    assert.ok(duplicate.every((r) => r.status === 201));
    assert.equal(new Set(duplicate.map((r) => r.body.id)).size, 1);
    assert.equal(creates, 1);
    const payment = duplicate[0].body;
    assert.ok(records.has(providerReference(payment.id)));
    assert.equal(
      (
        await request("/v1/payments", a.body.key, "POST", {
          ...input,
          amount: 999,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/v1/payments", a.body.key, "POST", {
          orderId: "bad",
          amount: -1,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/v1/payments/${payment.id}`, b.body.key)).status,
      404,
    );
    assert.equal(
      (await request(`/v1/payments/${payment.id}/refresh`, b.body.key, "POST"))
        .status,
      404,
    );
    const other = await request("/v1/payments", b.body.key, "POST", input);
    assert.equal(other.status, 201);
    assert.notEqual(other.body.id, payment.id);
    const callback = {
      orderId: providerReference(payment.id),
      status: "SUCCESS",
      amount: 25000,
      currency: "MMK",
    };
    assert.equal(
      (await request("/webhooks/mmpay", "", "POST", callback)).status,
      401,
    );
    const nonce = Date.now().toString();
    const sig = createHmac("sha256", secret)
      .update(`${nonce}.${JSON.stringify(callback)}`)
      .digest("hex");
    const headers = { "x-mmpay-nonce": nonce, "x-mmpay-signature": sig };
    assert.equal(
      (await request("/webhooks/mmpay", "", "POST", callback, headers)).status,
      200,
    );
    assert.equal(
      (await request(`/v1/payments/${payment.id}`, a.body.key)).body.status,
      "PENDING",
      "callback must not override authoritative pending status",
    );
    assert.equal(
      (
        await request(`/admin/apps/${a.body.id}/webhook`, owner, "POST", {
          url: "http://127.0.0.1/internal",
        })
      ).status,
      400,
    );
    const hook = await request(
      `/admin/apps/${a.body.id}/webhook`,
      owner,
      "POST",
      { url: "https://payments.example.com/byle" },
    );
    assert.equal(hook.status, 201);
    assert.ok(hook.body.secret.startsWith("whsec_"));
    records.get(providerReference(payment.id))!.status = "SUCCESS";
    assert.equal(
      (await request("/webhooks/mmpay", "", "POST", callback, headers)).status,
      200,
    );
    assert.equal(
      (await request(`/v1/payments/${payment.id}`, a.body.key)).body.status,
      "SUCCESS",
    );
    records.get(providerReference(payment.id))!.status = "PENDING";
    await request("/webhooks/mmpay", "", "POST", callback, headers);
    assert.equal(
      (await request(`/v1/payments/${payment.id}`, a.body.key)).body.status,
      "SUCCESS",
    );
    const checkoutToken = payment.checkout_url.split("/").pop();
    const publicPayment = await request(
      `/public/checkout/${checkoutToken}`,
      "",
    );
    assert.equal(publicPayment.status, 200);
    assert.equal(publicPayment.body.amount, "25000");
    const {rows:[created]} = await db.query('SELECT created_at FROM payments WHERE id=$1',[payment.id]);
    assert.equal(Date.parse(publicPayment.body.checkout_expires_at)-new Date(created.created_at).getTime(),15*60000);
    await db.query("UPDATE payments SET created_at=now()-interval '16 minutes' WHERE id=$1",[payment.id]);
    const closed = await request(`/public/checkout/${checkoutToken}`, '');
    assert.equal(closed.body.qr,null,'Expired display must not expose QR');
    await db.query('UPDATE payments SET created_at=$2 WHERE id=$1',[payment.id,created.created_at]);
    assert.ok(!("id" in publicPayment.body));
    assert.ok(!("app_id" in publicPayment.body));
    assert.equal((await request("/public/checkout/guess", "")).status, 404);
    const { rows: queued } = await db.query(
      "SELECT * FROM webhook_deliveries WHERE payment_id=$1",
      [payment.id],
    );
    assert.equal(
      queued.length,
      1,
      "repeated callbacks must not queue duplicate events",
    );
    assert.notEqual(queued[0].secret, hook.body.secret);
    assert.equal(unseal(queued[0].secret), hook.body.secret);
    let sent = 0;
    await tick(async (_url, encrypted, payload, eventId) => {
      sent++;
      const timestamp = "1730000000";
      assert.equal(
        deliverySignature(unseal(encrypted), timestamp, payload),
        createHmac("sha256", hook.body.secret)
          .update(`${timestamp}.${payload}`)
          .digest("hex"),
      );
      assert.equal(JSON.parse(payload).id, eventId);
      return 503;
    });
    assert.equal(sent, 1);
    assert.equal(
      (
        await db.query("SELECT attempts FROM webhook_deliveries WHERE id=$1", [
          queued[0].id,
        ])
      ).rows[0].attempts,
      1,
    );
    assert.equal(
      (await request(`/admin/deliveries/${queued[0].id}/resend`, owner, "POST"))
        .status,
      200,
    );
    await tick(async () => 204);
    assert.equal(
      (
        await db.query("SELECT state FROM webhook_deliveries WHERE id=$1", [
          queued[0].id,
        ])
      ).rows[0].state,
      "DELIVERED",
    );
    // Simulate a process dying after claiming a delivery; expired leases must recover.
    await db.query(
      "UPDATE webhook_deliveries SET state='PENDING',lease_until=now()-interval '1 minute',next_attempt_at=now() WHERE id=$1",
      [queued[0].id],
    );
    await tick(async () => 204);
    assert.equal(
      (
        await db.query("SELECT state FROM webhook_deliveries WHERE id=$1", [
          queued[0].id,
        ])
      ).rows[0].state,
      "DELIVERED",
    );
    await request(`/admin/deliveries/${queued[0].id}/resend`, owner, "POST");
    for (let i = 0; i < 10; i++) {
      await db.query(
        "UPDATE webhook_deliveries SET next_attempt_at=now() WHERE id=$1",
        [queued[0].id],
      );
      await tick(async () => 503);
    }
    assert.equal(
      (
        await db.query("SELECT state FROM webhook_deliveries WHERE id=$1", [
          queued[0].id,
        ])
      ).rows[0].state,
      "FAILED",
    );
    const timeline = await request(`/admin/payments/${payment.id}/events`);
    assert.ok(
      timeline.body.events.some(
        (e: { kind: string }) => e.kind === "payment.status_changed",
      ),
    );
    assert.ok(
      timeline.body.deliveries.some(
        (d: { state: string }) => d.state === "FAILED",
      ),
    );
    assert.ok(!JSON.stringify(timeline.body).includes(hook.body.secret));
    const attention = await request("/admin/overview?attention=true&days=7");
    assert.ok(
      attention.body.payments.some((p: { id: string }) => p.id === payment.id),
    );
    records.get(providerReference(other.body.id))!.status = "SUCCESS";
    await db.query("UPDATE payments SET next_check_at=now() WHERE id=$1", [
      other.body.id,
    ]);
    await tick(async () => 204);
    assert.equal(
      (await request(`/v1/payments/${other.body.id}`, b.body.key)).body.status,
      "SUCCESS",
      "worker recovers payment without callback",
    );
    await db.query(
      "INSERT INTO payments(id,app_id,order_id,amount,status) SELECT gen_random_uuid(),$1,'report-'||n,100,'SUCCESS' FROM generate_series(1,600) n",
      [a.body.id],
    );
    const report = await request(`/admin/overview?app=${a.body.id}&limit=25`);
    assert.equal(report.body.payments.length, 25);
    assert.equal(report.body.total, 601);
    assert.equal(report.body.summary.volume, "85000");
    assert.equal(
      (await request(`/admin/overview?app=${a.body.id}&limit=25&page=25`)).body
        .payments.length,
      1,
    );
    const csv = await fetch(
      `http://127.0.0.1:4402/admin/payments/export?app=${a.body.id}`,
      { headers: { Authorization: `Bearer ${owner}` } },
    );
    assert.equal(csv.status, 200);
    assert.equal((await csv.text()).trim().split("\n").length, 602);
    const rotated = await request(
      `/admin/apps/${a.body.id}/rotate-key`,
      owner,
      "POST",
    );
    assert.equal(rotated.status, 201);
    assert.equal(rotated.body.id, a.body.id);
    assert.equal(
      (await request(`/v1/payments/${payment.id}`, a.body.key)).status,
      401,
    );
    a.body.key = rotated.body.key;
    assert.equal(
      (await request(`/v1/payments/${payment.id}`, a.body.key)).status,
      200,
    );
    records.get(providerReference(payment.id))!.amount = 1;
    assert.equal(
      (await request(`/v1/payments/${payment.id}/refresh`, a.body.key, "POST"))
        .status,
      409,
    );
    assert.equal(
      (await request(`/admin/apps/${a.body.id}/key`, owner, "DELETE")).status,
      200,
    );
    assert.equal(
      (await request(`/v1/payments/${payment.id}`, a.body.key)).status,
      401,
    );
    const overview = await request("/admin/overview");
    assert.ok(!JSON.stringify(overview.body).includes(a.body.key));
    assert.ok(!JSON.stringify(overview.body).includes("key_hash"));
    console.log(
      "Integration passed: signed provider requests, PostgreSQL persistence, concurrent idempotency, isolation, validation, signed callbacks, authoritative status, monotonic transitions, amount mismatch, revocation, and secret redaction, hosted checkout privacy, automatic reconciliation, encrypted webhook outbox, retry exhaustion, expired lease recovery, event history, key rotation, full-database totals, pagination, and CSV export.",
    );
  } finally {
    server.kill("SIGTERM");
    mock.closeAllConnections();
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    if (appIds.length) {
      await db.query("DELETE FROM payments WHERE app_id=ANY($1::uuid[])", [
        appIds,
      ]);
      await db.query("DELETE FROM apps WHERE id=ANY($1::uuid[])", [appIds]);
    }
    await db.end();
    await adminDb.query(`DROP SCHEMA ${namespace} CASCADE`);
    await adminDb.end();
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
