import { config } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";
config({ path: resolve(__dirname, "../../../.env") });
export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
export const schema = `
CREATE TABLE IF NOT EXISTS apps (
 id uuid PRIMARY KEY, name text NOT NULL, key_hash text UNIQUE NOT NULL,
 key_prefix text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS payments (
 id uuid PRIMARY KEY, app_id uuid NOT NULL REFERENCES apps(id), order_id text NOT NULL,
 amount bigint NOT NULL CHECK(amount > 0 AND amount <= 100000000), currency text NOT NULL DEFAULT 'MMK' CHECK(currency = 'MMK'),
 status text NOT NULL DEFAULT 'CREATING' CHECK(status IN ('CREATING','PENDING','SUCCESS','FAILED','EXPIRED','CANCELLED','REFUNDED')),
 qr text, description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(app_id, order_id)
);
ALTER TABLE apps ADD COLUMN IF NOT EXISTS webhook_url text;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS webhook_secret text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_token text UNIQUE;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes');
ALTER TABLE payments ALTER COLUMN checkout_expires_at SET DEFAULT (now() + interval '15 minutes');
ALTER TABLE payments ADD COLUMN IF NOT EXISTS next_check_at timestamptz NOT NULL DEFAULT (now() + interval '30 seconds');
ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_lease_until timestamptz;
CREATE TABLE IF NOT EXISTS payment_events (
 id uuid PRIMARY KEY, payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
 kind text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_events_payment_idx ON payment_events(payment_id, created_at);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
 id uuid PRIMARY KEY, event_id uuid UNIQUE NOT NULL REFERENCES payment_events(id) ON DELETE CASCADE,
 app_id uuid NOT NULL REFERENCES apps(id) ON DELETE CASCADE, payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
 url text NOT NULL, secret text NOT NULL, payload text NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELIVERED','FAILED')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz, lease_id uuid, last_status integer, last_error text, created_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
ALTER TABLE webhook_deliveries ADD COLUMN IF NOT EXISTS lease_id uuid;
CREATE INDEX IF NOT EXISTS webhook_due_idx ON webhook_deliveries(next_attempt_at) WHERE state='PENDING';
CREATE INDEX IF NOT EXISTS payments_due_idx ON payments(next_check_at) WHERE status IN ('CREATING','PENDING');
CREATE TABLE IF NOT EXISTS owner_sessions (
 token_hash text PRIMARY KEY,credential_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT(now()+interval '8 hours')
);
CREATE INDEX IF NOT EXISTS owner_sessions_expiry_idx ON owner_sessions(expires_at);
CREATE TABLE IF NOT EXISTS gateway_runtime (id text PRIMARY KEY, last_tick_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS gateway_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
UPDATE payments SET checkout_expires_at=created_at+interval '15 minutes'
 WHERE checkout_expires_at>created_at+interval '15 minutes'
 AND NOT EXISTS(SELECT 1 FROM gateway_migrations WHERE version=4);
INSERT INTO gateway_migrations(version) VALUES(1),(2),(3),(4) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS payments_created_idx ON payments(created_at DESC);
`;
