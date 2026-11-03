# Byle Gateway

A single-owner payment gateway shared by your apps. Next.js serves the dashboard and hosted checkout, NestJS serves the API and background worker, PostgreSQL stores payments and delivery jobs, and MyanMyanPay processes MMQR payments.

## Included

- Database-backed, revocable owner sessions and one-time, hashed app keys with in-place rotation and revocation.
- Idempotent integer-MMK payments, hosted QR checkout, authoritative status checks, and signed provider callbacks.
- Automatic reconciliation of missed callbacks and uncertain creations.
- Signed app webhooks with encrypted secrets, durable retries, restart recovery, delivery history, and manual resend.
- Payment event timeline and a Needs attention view for stale payments, reconciliation errors, and failed deliveries.
- PostgreSQL-backed totals, server-side search/filtering, pagination, and complete CSV export.
- Explicit sandbox/live labels and a setup checklist with actual database/worker checks and callback history.
- Production container configuration with HTTPS termination, private database/admin routes, request limits, and security headers.

## Start locally

Use Node.js 22.13+ (Node 24 LTS recommended), npm, and Docker Compose.

```sh
npm ci
cp .env.example .env
```

Set a unique owner password of at least 16 characters and generate **separate** random secrets for `OWNER_TOKEN`, `WEBHOOK_ENCRYPTION_KEY`, and `RUNTIME_DATABASE_PASSWORD` using `openssl rand -hex 32`. Keep `.env` private and out of source control. Set `CHECKOUT_ORIGIN=http://127.0.0.1:3000` for local checkout. Enter your MyanMyanPay credentials and actual provider-assigned API base URL when ready.

Use the exact `RUNTIME_DATABASE_PASSWORD` value in `DATABASE_URL` for the `byle_app` role. `MIGRATION_DATABASE_URL` uses the local bootstrap role (`byle:byle_local`) to create the schema and provision the restricted runtime role. The normal API cannot create schemas, create roles, or act as a database superuser. Production Compose constructs these two URLs separately.

```sh
docker compose up -d postgres
npm run db:migrate -w apps/api
npm run dev
```

Open <http://127.0.0.1:3000>. You will be redirected to the owner sign-in page. Use the `OWNER_PASSWORD` from your private `.env`. Every dashboard screen reads PostgreSQL; a new database shows zero payments and an empty application list until you register your own apps. The API is <http://127.0.0.1:4000> and PostgreSQL uses loopback port **55432**.

For existing installations, back up the database, apply `db:migrate`, and restart the API. The migration adds fields/tables and generates private checkout tokens for older records without deleting payment history. Migration versions are recorded in `gateway_migrations`.

## Connect payments and app notifications

Obtain merchant credentials and the API base URL from MyanMyanPay. Set `PUBLIC_API_URL` to your reachable HTTPS API origin without a trailing slash. Configure the provider callback as `PUBLIC_API_URL/webhooks/mmpay`. The official SDK selects sandbox endpoints when either credential contains `_test_`; use separate deployments/databases for sandbox and live operation.

Register an application and copy its key. Your app backend calls `POST /v1/payments`; the response includes `checkout_url` and QR data. Send customers to the hosted URL or render the QR in your own app. Never expose your app key in browser code, and fulfill orders only from a verified payment record or signed notification checked against your order database.

For outgoing notifications, set `WEBHOOK_ALLOWED_HOSTS` to your exact app hostnames (comma-separated). In Applications, open **Keys & webhooks**, enter an HTTPS endpoint, and save its one-time signing secret. Private, loopback, and link-local addresses are blocked; DNS answers are validated and pinned for each request. No Redis or separate message broker is required.

- [Integration walkthrough and webhook verification](docs/INTEGRATION.md)
- [API reference, filters, checkout, and delivery controls](docs/API.md)
- [Deployment, secrets, worker behavior, backups, and recovery](docs/OPERATIONS.md)
- [Railway services, releases, and production setup](docs/RAILWAY.md)

Provider references: [Node SDK documentation](https://docs.myanmyanpay.com/sdk-node/) and [sandbox FAQ](https://myanmyanpay.com/faqs). Sandbox payments must be simulated using the provider dashboard, not scanned using a live banking app.

## Verify

```sh
npm test
npm run typecheck
npm run build
npm run test:integration -w apps/api
```

The integration test creates and drops an isolated, randomly named PostgreSQL schema. It uses a local provider mock, never moves money, and covers concurrent idempotency, isolation, callbacks, worker recovery, encrypted app webhooks, retries, expired leases, rotation, checkout privacy, and reports beyond 500 records. It needs permission to create/drop a schema in the development database and free ports 4401/4402.

With both development servers running, `npm run test:session` verifies owner login, cross-origin rejection, registration, and revocation through the Next.js proxy, logout replay rejection, and restricted database privileges, removing its temporary app afterward.

Verify backup restoration against the local database:

```sh
docker compose exec -T postgres sh -s < deploy/verify-backup.sh
```

Build before starting development servers; `next build` and `next dev` must not write the same `.next` directory at once.

## Scope

Amounts are whole kyat (1–100,000,000 MMK) stored as PostgreSQL bigint and returned as strings. This is a single-owner gateway, not a bank or accounting ledger. MyanMyanPay manages merchant verification, settlement, and refunds; refund initiation is not implemented here. There are no team accounts, subscription plans, or additional providers.

Real merchant-sandbox and live transactions require your credentials and a reachable HTTPS callback. Production DNS, TLS issuance, offsite backup storage, and merchant approval depend on your deployment environment.
