# API reference

The NestJS origin is the API base URL. Requests/responses are JSON unless stated otherwise. Bearer keys stay on application backends. Money is a string in responses, an integer in create requests. Timestamps use UTC; the dashboard displays Asia/Yangon.

## Application API

`Authorization: Bearer bg_...`

| Method | Route                      | Result                                             |
| ------ | -------------------------- | -------------------------------------------------- |
| POST   | `/v1/payments`             | Create or return the existing app/order pair (201) |
| GET    | `/v1/payments/:id`         | Read stored payment (200)                          |
| POST   | `/v1/payments/:id/refresh` | Reconcile through provider (200)                   |

Create body:

```json
{
  "orderId": "order-1049",
  "amount": 25000,
  "currency": "MMK",
  "description": "Digital product order"
}
```

`orderId` is 1–100 ASCII letters/digits/dots/underscores/hyphens. `amount` is an integer from 1 to 100,000,000 whole kyat. Optional `currency` must be `MMK`; optional `description` is at most 200 characters. Reusing an order with changed amount or description returns 409. A retry never silently creates another provider payment.

Payment responses contain `id`, `app_id`, `order_id`, `amount`, `currency`, `status`, `qr`, `description`, creation/update/check timestamps, `checkout_expires_at`, `checkout_url`, and reconciliation metadata. `checkout_token` is never returned as a separate field. `qr`/`checkout_url` may be null for incomplete/legacy records. Migration backfills checkout tokens on older records. Status values: CREATING, PENDING, SUCCESS, FAILED, EXPIRED, CANCELLED, REFUNDED.

## Public checkout

`GET /public/checkout/:token` requires the 256-bit capability token embedded in the hosted checkout URL, not an app key. It returns only app display name, order reference, amount/currency, description, status, checkout expiry, and QR data while the checkout window is open and payment is pending. It never returns app keys, internal app/payment IDs, timeline, or customer information. Invalid tokens return 404.

The Next.js checkout is `/checkout/:token`, polling through `/api/checkout/:token` every five seconds. Treat the link as private. No third-party assets or analytics are loaded. The 30-minute display window is not proof of provider expiry or cancellation; late payments are still reconciled. Status may still be read after the QR window closes.

## Owner API

`Authorization: Bearer <OWNER_TOKEN>`. The dashboard requires sign-in and uses an HTTP-only, server-revocable opaque session with a server-side proxy; it never exposes this token.

| Method | Route                          | Behavior                                                                                                  |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/overview`              | Filtered page, database-wide summary, 7 activity buckets, app metadata and environment                    |
| GET    | `/admin/payments/export`       | Stream all matching payments as CSV, without a page cap                                                   |
| GET    | `/admin/setup`                 | Database connectivity, worker freshness, credential presence, HTTPS origin checks, last verified callback |
| POST   | `/admin/apps`                  | Body `{ "name": "Byle Store" }`; return app and one-time key                                              |
| POST   | `/admin/apps/:id/rotate-key`   | Immediately invalidate old key, activate replacement on same app; return one-time key                     |
| DELETE | `/admin/apps/:id/key`          | Revoke app key without deleting history                                                                   |
| POST   | `/admin/apps/:id/webhook`      | Body `{ "url": "https://your-app.com/webhooks/byle" }`; return one-time signing secret                    |
| POST   | `/admin/payments/:id/refresh`  | Owner reconciliation                                                                                      |
| GET    | `/admin/payments/:id/events`   | Latest 200 timeline events and all delivery summaries                                                     |
| POST   | `/admin/deliveries/:id/resend` | Requeue original event with original destination/secret; 409 while leased                                 |

Webhook URLs must use HTTPS/443, have no credentials or fragment, and match `WEBHOOK_ALLOWED_HOSTS` exactly. Saving validates that every DNS address is public before changing the URL or signing secret. Saving always creates a new signing secret. An empty URL disables **future** notifications; existing queued deliveries retain their snapshot destination/secret. Do not configure secrets in URL query parameters. All owner mutation routes require the owner token; Next.js proxy mutations additionally require same-origin browser requests.

Report query parameters:

| Parameter   | Values                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------- |
| `days`      | 7 (default), 30, 365                                                                         |
| `app`       | App UUID or `all`                                                                            |
| `search`    | Literal, case-insensitive substring of order, app name, or payment ID; max 200 characters    |
| `status`    | One payment status or empty                                                                  |
| `attention` | `true` to select stale pending/creating records, reconciliation errors, or failed deliveries |
| `page`      | 1-based page, max 100000                                                                     |
| `limit`     | 1–100; default 25                                                                            |

`overview` returns `{apps,payments,summary,total,page,limit,activity,configured,mode}`. Summary (`total`, `successful`, `volume`, `pending`) covers **all** records in the selected app/date period. Search, status, and attention apply to the table/count/export, leaving summary cards consistent with the selected app/date period. Activity contains seven chronological collected-volume buckets spanning that period. Paging sorts by creation timestamp and ID. CSV uses a consistent database snapshot and a keyset cursor. Cells are quoted and formula-leading values are neutralized.

`mode` is `unconfigured`, `sandbox`, or `live`, reflecting credential presence and sandbox inference from provider keys; `configured` means required values are present, not that the provider accepted them. Setup checks explicitly distinguish configuration presence from a verified callback. Callback history proves a signed request was received in that deployment; it does not prove merchant approval or successful order fulfillment.

## Notifications

Outgoing payload example:

```json
{
  "id": "event-uuid",
  "type": "payment.status_changed",
  "createdAt": "2026-11-03T10:00:00.000Z",
  "data": {
    "id": "payment-uuid",
    "orderId": "order-1049",
    "amount": "25000",
    "currency": "MMK",
    "status": "SUCCESS"
  }
}
```

Headers: `Byle-Event-Id`, `Byle-Timestamp` (Unix seconds), `Byle-Signature` (hex HMAC-SHA256 of `timestamp + '.' + exact_body_bytes`). Accept only a recent signature and matching body/header event ID. Notifications are at least once and can arrive out of order. Use the event ID for deduplication, validate the amount/order against your records, and fulfill once in your database transaction. For ambiguous or older events, read the current gateway payment.

Any 2xx acknowledges delivery. Other responses, redirects, timeouts, blocked DNS addresses, and network errors retry up to ten attempts with exponential backoff capped at one hour. A manual resend resets the attempt count while preserving the event ID. Initial create responses are not notifications; events are queued when authoritative reconciliation changes the stored state. There is no replay of older events when first enabling a webhook.

## Provider callbacks and health

`POST /webhooks/mmpay` authenticates raw body bytes using provider `X-Mmpay-Nonce` and `X-Mmpay-Signature`. It records callback receipt and independently retrieves the provider record before updating state. Duplicate callbacks cannot create duplicate status events/outbox records. `GET /health` tests PostgreSQL only.

## Errors and limits

400 invalid input; 401 invalid/revoked credential or signature; 404 absent/foreign record; 409 conflicting details, busy resend, or provider mismatch; 429 request limit; 503 unavailable/unconfigured provider. Unexpected database errors may return 500. A 503 does not prove the provider rejected the payment: retry the **same** order and reconcile it.

The single-process API allows up to 600 requests/minute per observed client IP; the owner login has a separate ten-failure/minute limiter. Production reverse-proxy body limit is 100 KB. Use a shared rate limiter before adding replicas. API admin and health routes are blocked on the public API hostname in the included Caddy configuration.

## Owner sign-in

The Next.js root requires a valid owner session and redirects to `/login` otherwise. `POST /api/session` authenticates the configured owner password. `DELETE /api/session` revokes the database session before clearing the cookie, and `GET /api/session` checks that the token still exists, is unexpired, and matches the current credential revision. Login failures are limited per trusted client address. Owner passwords must be at least 16 characters.

Private NestJS `/admin/sessions` and `/admin/sessions/current` endpoints are used only by the Next.js server with the owner token. They are not forwarded by the browser's generic API proxy and are blocked on the public API hostname. App API keys cannot create or inspect owner sessions.
