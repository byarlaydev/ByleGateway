import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { schema } from "./db";
const migrationDb = new Pool({
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
(async () => {
  const client = await migrationDb.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(24897102)");
    await client.query(schema);
    while (true) {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM payments WHERE checkout_token IS NULL LIMIT 1000",
      );
      if (!rows.length) break;
      await client.query(
        "UPDATE payments p SET checkout_token=v.token FROM unnest($1::uuid[],$2::text[]) AS v(id,token) WHERE p.id=v.id",
        [
          rows.map((r) => r.id),
          rows.map(() => randomBytes(32).toString("hex")),
        ],
      );
    }
    const password = process.env.RUNTIME_DATABASE_PASSWORD;
    if (password) {
      if (!/^[a-f0-9]{32,128}$/.test(password))
        throw new Error(
          "RUNTIME_DATABASE_PASSWORD must be a random hexadecimal secret",
        );
      const exists = await client.query(
        "SELECT 1 FROM pg_roles WHERE rolname='byle_app'",
      );
      const {
        rows: [statement],
      } = await client.query("SELECT format($1::text,$2::text) AS sql", [
        exists.rowCount
          ? "ALTER ROLE byle_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L"
          : "CREATE ROLE byle_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L",
        password,
      ]);
      await client.query(statement.sql);
      await client.query("GRANT USAGE ON SCHEMA public TO byle_app");
      await client.query(
        "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO byle_app",
      );
      await client.query(
        "GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO byle_app",
      );
      await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    }
    await client.query("COMMIT");
    console.log(
      "Database migrated; payment history preserved and runtime permissions applied.",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await migrationDb.end();
  }
})().catch(() => {
  console.error(
    "Migration failed. Check migration credentials and runtime password configuration.",
  );
  process.exitCode = 1;
});
