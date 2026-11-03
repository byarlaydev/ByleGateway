# Railway deployment

The production project runs PostgreSQL, a private NestJS `api`, a private Next.js `web`, a public Caddy `gateway`, and a one-shot `migrate` service. Only the gateway has a public domain. Railway terminates HTTPS; Caddy routes `/v1/*` and `/webhooks/mmpay` to the API and other requests to Next.js. Direct `/admin/*` and `/health` requests are blocked.

Production URL: https://gateway-production-d73b.up.railway.app

## Service configuration

All application services build the root Dockerfile. Its `SERVICE` build argument selects the runtime stage; set the same-named Railway variable to `api`, `web` (default), or `migrate`. The gateway uses `RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile.proxy` and `PORT=8080`.

- `api`: `PORT=4000`, `API_BIND_ADDRESS=0.0.0.0`, `WORKER_ENABLED=true`, restricted-role `DATABASE_URL`, `OWNER_TOKEN`, `WEBHOOK_ENCRYPTION_KEY`, and the public origin in both `PUBLIC_API_URL` and `CHECKOUT_ORIGIN`.
- `web`: `PORT=3000`, `API_ORIGIN=http://api.railway.internal:4000`, `TRUST_PROXY=true`, `OWNER_TOKEN`, and `OWNER_PASSWORD`. It receives no database or merchant credentials.
- `migrate`: `SERVICE=migrate`, administrator `MIGRATION_DATABASE_URL`, and `RUNTIME_DATABASE_PASSWORD`. It exits after applying additive migrations and granting the restricted runtime role. Never put its administrator URL on `api` or `web`.
- PostgreSQL: persistent Railway volume and private networking. No public TCP proxy is required.

Secrets are stored as Railway service variables. Ignored local `.env.railway*` files are private deployment records, never source files. The production owner password initially matches the local `.env` owner password; rotate it in Railway's `web` service when required. Password changes invalidate existing owner sessions.

## Release updates

Link the CLI with `railway link` and select ByleGateway / production. The API, web, and gateway automatically deploy pushes to GitHub's `main` branch. The migration service is intentionally manual. For schema changes, deploy migrations from the reviewed local checkout **before pushing** the application update, and confirm its logs say `Database migrated; payment history preserved and runtime permissions applied.` A successful migration exits normally; it is not a continuously running web service. Keep migrations compatible with the currently running release.

```sh
railway up --service migrate --detach
railway logs --service migrate --lines 50
# After migration succeeds, push to main for automatic deployment.
# Manual deployment is also available:
railway up --service api --detach
railway up --service web --detach
railway up --service gateway --detach
```

Keep one replica per application service: login/API throttling is per process. Check `/login`, owner sign-in, Setup, logout, and blocked public `/admin/overview` after each release. Take a database backup before schema updates; configure Railway volume backups and test restore before processing live money.

## Enable real payments

Set `MMPAY_APP_ID`, `MMPAY_PUBLISHABLE_KEY`, `MMPAY_SECRET_KEY`, and your provider-assigned `MMPAY_API_BASE_URL` on `api` only. Set the provider callback to `https://gateway-production-d73b.up.railway.app/webhooks/mmpay`. Add your apps' exact notification hostnames to `WEBHOOK_ALLOWED_HOSTS`. Redeploy `api`, then use the dashboard Setup checks and perform a merchant sandbox payment before enabling live credentials. Credentials are intentionally absent from the initial deployment.

Integration clients use `https://gateway-production-d73b.up.railway.app/v1/payments`; see [INTEGRATION.md](INTEGRATION.md) for authentication, idempotency, and signed notifications.
