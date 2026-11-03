# Operations and deployment

## Local operation and upgrades

Use `npm run db:migrate -w apps/api` before restarting upgraded services. The migration runs under a transaction/advisory lock, preserves existing records, adds the new worker/outbox/event tables and columns, and backfills missing checkout tokens. Versions are recorded in `gateway_migrations`. Future schema changes should append explicit versioned changes rather than alter existing deployed SQL assumptions.

By default, both Node services bind to loopback. PostgreSQL runs on loopback port 55432 using `compose.yaml`. The local development password is not a production password. Never expose `next dev` publicly.

## Production containers and HTTPS

The included `Dockerfile`, `compose.production.yaml`, and `deploy/Caddyfile` provide a small single-host deployment with separate Next.js/NestJS containers, PostgreSQL, a migration job, and Caddy. Only ports 80/443 are exposed. Caddy obtains HTTPS certificates after your DNS points to the host and the required ports are reachable. It denies `/admin`, `/admin/*`, and `/health` on the public API hostname; the dashboard proxy reaches admin routes over the private container network.

Set these in the deployment `.env`:

```dotenv
DASHBOARD_HOST=gateway.your-domain.com
PUBLIC_API_HOST=payments.your-domain.com
PUBLIC_API_URL=https://payments.your-domain.com
CHECKOUT_ORIGIN=https://gateway.your-domain.com
```

Also set a strong hexadecimal `POSTGRES_PASSWORD` (avoids URL-encoding ambiguity), a random owner token, owner password of at least 16 characters, separate runtime database password, and separate webhook encryption key, your provider credentials/API base URL, and the app webhook hostname allowlist. Keep the file mode 600. No `.env` files are copied into container images. Each container receives only its explicit environment allowlist: Next.js has no database credentials, merchant keys, or webhook encryption key. The migration job alone receives admin database credentials; the API uses the restricted `byle_app` role.

```sh
docker compose -p byle-production -f compose.production.yaml up -d --build
```

Use a different project name from development to keep production volumes separate. Migration must succeed before the API starts. For upgrades, back up first, rebuild, and recreate the migration job before restarting the API:

```sh
docker compose -p byle-production -f compose.production.yaml build
docker compose -p byle-production -f compose.production.yaml run --rm migrate
docker compose -p byle-production -f compose.production.yaml up -d
```

Prefer VPN/proxy access controls for the owner dashboard as another layer. The public customer checkout must remain reachable. No public app signups or user accounts exist. The production proxy limits request bodies to 100 KB and supplies CSP, anti-framing, content-type, no-referrer, and no-store headers. The API limits each observed IP to 600 requests/minute; login has a ten-failure/minute limiter. Login failures are counted per trusted client address, so another address cannot consume your allowance. These counters are process-local: deploy one API replica, or introduce shared/proxy rate limiting before scaling. Trust only your controlled reverse proxy; do not expose the container API port directly. Next.js checkout proxy traffic shares its backend IP limit, which is adequate for this personal deployment; use a dedicated shared customer limiter for higher traffic.

## Configuration

`MIGRATION_DATABASE_URL` belongs only to the migration process. `RUNTIME_DATABASE_PASSWORD` provisions `byle_app` and must match the runtime connection URL. `TRUST_PROXY=true` belongs only to the web container behind the controlled production proxy.

| Variable                                                      | Purpose                                                                           |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                | Restricted runtime PostgreSQL URL; production Compose uses `byle_app`             |
| `OWNER_TOKEN`                                                 | Random 32+ character server-only bearer token for Next.js → NestJS owner requests |
| `OWNER_PASSWORD`                                              | Long unique owner password (16+ characters required)                           |
| `API_ORIGIN`                                                  | Private API origin used by Next.js; Compose overrides to `http://api:4000`        |
| `PUBLIC_API_URL`                                              | Public HTTPS API origin, no trailing slash                                        |
| `CHECKOUT_ORIGIN`                                             | Public HTTPS Next.js/checkout origin                                              |
| `MMPAY_APP_ID` / `MMPAY_PUBLISHABLE_KEY` / `MMPAY_SECRET_KEY` | Matching merchant credentials                                                     |
| `MMPAY_API_BASE_URL`                                          | Actual provider-assigned API URL                                                  |
| `WEBHOOK_ENCRYPTION_KEY`                                      | Separate stable 32+ character secret for AES-256-GCM encryption                   |
| `WEBHOOK_ALLOWED_HOSTS`                                       | Comma-separated exact HTTPS recipient hostnames                                   |
| `WORKER_ENABLED`                                              | Defaults on; `false` disables worker only for controlled testing/maintenance      |
| `API_BIND_ADDRESS` / `PORT`                                   | Default loopback/4000; Compose uses private container interfaces                  |

The process environment takes precedence over local `.env`. Restart after changes. Owner sessions use random opaque tokens, stored only as SHA-256 hashes in PostgreSQL with an eight-hour expiry. Sign out deletes the server record before clearing the browser cookie; copied cookies cannot be reused after logout. Sessions are checked against the current owner password/token credential revision, so changing either and restarting the services invalidates existing sessions. Invalid legacy cookies are rejected.

`MIGRATION_DATABASE_URL` is used only by the migration process. Set `RUNTIME_DATABASE_PASSWORD` to a separate random hexadecimal secret; migrations provision `byle_app` with data access but without superuser, database creation, role creation, or schema creation privileges. Local development uses one private `.env` on your trusted workstation; the production containers receive separate explicit environment values. Never expose development servers or set `TRUST_PROXY=true` unless the web service can only be reached through your controlled reverse proxy.

**Do not replace or lose `WEBHOOK_ENCRYPTION_KEY` while encrypted app secrets/deliveries exist.** Back it up separately. Encryption-key rotation requires a controlled re-encryption migration; changing the variable alone makes stored secrets unreadable.

The SDK infers sandbox when either provider key contains `_test_`. Sandbox/live use separate databases, credentials, encryption keys, and callback URLs. Never switch an active database to another provider environment. The UI mode label reflects configuration, not merchant approval.

## Worker and payment recovery

The API runs one worker tick every ten seconds, claiming at most five due reconciliation jobs and five outgoing deliveries using PostgreSQL row locks with `SKIP LOCKED`. Leases make jobs recoverable after a restart; outbound completion updates are fenced by a unique claim ID. Worker ticks do not overlap in one process. Restart-safe state lives in PostgreSQL, not memory. Monitor worker heartbeat using the owner setup checklist.

A new payment becomes eligible for reconciliation after 30 seconds. Pending/creating payments are checked approximately every minute after a successful lookup. Failures back off exponentially up to one hour. Automatic checks stop at seven days; older unresolved records remain visible for manual refresh/review. A missing callback never causes a fresh provider payment to be created. The SDK operation timeout is 15 seconds, but the SDK cannot abort its underlying request; late provider completion can still be recovered by the same payment ID.

A callback signature is verified before recording receipt, then an independent signed provider lookup validates the actual order/amount/currency/status. State transitions and outgoing event insertion are committed together. Paid records never regress to pending/failed. Conflicting terminal states are flagged for review; refunds follow a provider-reported SUCCESS → REFUNDED transition. Duplicate callbacks may add receipt events but cannot duplicate a status-change notification.

**Needs attention** selects payments with reconciliation errors, pending/creating records older than 30 minutes, and payments with exhausted webhook deliveries, within the selected date range. Use a longer date range when reviewing older records. A checkout window ending is not provider cancellation; never ask a customer to pay again until an uncertain order has been investigated.

## App webhook delivery

Only explicitly allowed HTTPS hostnames on port 443 are accepted. Private, loopback, link-local, multicast, mapped IPv4, and common transition-network addresses are blocked after DNS resolution. All DNS answers must pass; the selected vetted IP is pinned for the TLS request. Certificate verification remains enabled, redirects are not followed, and response bodies are not logged. DNS lookup is bounded to five seconds and the HTTPS request to ten seconds. Secrets are encrypted at rest and shown only when created.

Notifications have stable event IDs and exact serialized bodies; each attempt has a fresh signed timestamp. Receivers must deduplicate and tolerate out-of-order delivery. Non-2xx responses or errors retry ten times with exponential backoff capped at one hour; exhausted deliveries become FAILED. Manual resend queues the same event/destination/secret and resets attempts. Saving a new recipient does not rewrite queued deliveries; keep the old receiver/secret available until its jobs drain. Disabling a URL prevents future notifications but does not erase or cancel existing jobs. Change the allowlist if a compromised destination must be blocked immediately; its queued jobs will fail safely.

Keep logs private. Never log API keys, Authorization headers, cookies, secrets, signatures, or full provider bodies. Events contain selected status/error metadata only. The latest 200 events are shown per payment; the stored event history is retained. Establish retention appropriate to your usage before large volume growth.

## Backups and restoration

Back up PostgreSQL and the encryption key separately. App API keys are hashed and cannot be recovered; encrypted webhook secrets need the same encryption key after restoration. Protect database backups because they include payment history and private checkout links. Use encrypted offsite storage with a retention policy; a local Docker volume alone is not a backup.

Example production dump (store the result securely):

```sh
docker compose -p byle-production -f compose.production.yaml exec -T postgres pg_dump -U byle -d byle -Fc > byle-backup.dump
```

Verify a fresh backup by restoring it into an isolated temporary database inside the local container:

```sh
docker compose exec -T postgres sh -s < deploy/verify-backup.sh
```

For production, use the same command with `-p byle-production -f compose.production.yaml`. The script creates and drops only its own `byle_restore_check_*` database, removes its temporary dump, and checks migration version/core tables. It never overwrites the source database. Run restoration checks periodically and after schema upgrades. Provision offsite backup storage and scheduling in your deployment environment; no cloud storage credentials are assumed.

`docker compose down` retains volumes. `down -v` permanently deletes them. Avoid volume deletion unless you intend to erase all records.

## Verification boundary

Local automated tests use a real PostgreSQL instance and an isolated schema, plus a mock provider and injected webhook sender. They verify application behavior without a real merchant transaction. The security unit tests verify signatures, encryption tampering, URL allowlists, and blocked network ranges. They do not prove remote TLS issuance or actual recipient/provider reachability. Complete a merchant-sandbox checkout and app fulfillment, then a controlled live transaction, before production use. Deployment needs your real domains, merchant credentials, and secure offsite backup destination.
