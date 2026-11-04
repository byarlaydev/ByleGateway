export function integrationPrompt(gatewayUrl: string) {
  return `Integrate this application with my existing Byle Gateway for MyanMyanPay MMQR payments. Inspect the app's framework, authentication, orders, database, and existing payment code first. Implement the complete flow using its existing conventions and dependencies.

Gateway configuration:
- GATEWAY_URL=${new URL(gatewayUrl).origin}
- GATEWAY_KEY=<this application's bg_ API key, supplied through backend secrets>
- GATEWAY_WEBHOOK_SECRET=<the whsec_ signing secret, supplied through backend secrets>
Never request secrets in chat, commit them, log them, or expose them in browser/mobile code. Add placeholder entries to the app's environment example. The gateway owner registers this app in Applications and supplies its one-time key securely; do not use owner credentials or another app's key.

Payment API (server-to-server, Authorization: Bearer GATEWAY_KEY):
1. POST /v1/payments with JSON {"orderId":"order-1049","amount":25000,"currency":"MMK","description":"Order payment"}. Read the amount from the authenticated customer's saved order in the app database, never from browser input. Amount is an integer from 1 to 100000000 whole kyat. orderId is 1–100 ASCII letters, digits, dots, underscores, or hyphens; description is at most 200 characters. Persist the order first and reuse exactly the same orderId, amount, and description on retries. Changed details return 409. Timeouts/5xx do not prove payment creation failed; never generate a replacement order automatically.
2. Responses are direct payment objects with id, order_id, amount (string), currency, status, qr, and checkout_url. Persist the gateway payment id against the local order. Redirect the customer to checkout_url when present. Treat this URL as a private bearer link. A null QR or CREATING status means preparing; do not assume failure. There is no configurable return URL; provide an order-status page in this app for customers returning themselves.
3. GET /v1/payments/:id reads the current record. POST /v1/payments/:id/refresh reconciles with the provider. Encode IDs in paths. Poll only through this app's authenticated backend, enforcing order ownership, with bounded backoff and request timeouts. Handle 400, 401, 404, 409, 429, and 503 explicitly. Retry transient failures using the original order. A checkout display expires after 15 minutes, but late payment may still succeed.

Required payment UI (provider review requirements):
- Display only MMK prices. Clearly show the official, unmodified MyanmarPay MMQR logo separately from the QR. Use the gateway logo asset at ${new URL(gatewayUrl).origin}/mmqr-logo.png; preserve its colors and aspect ratio.
- Render the exact provider QR payload with a normal black-on-white QR and quiet zone; never edit the payload, recolor it, crop it, or overlay the logo on the code.
- Directly below the QR show exactly: PAYMENT POWERED BY MYANMYANPAY
- Show a visible 15-minute countdown with a progress indicator based on checkout_expires_at, never a timer that resets on reload. Hide the QR and disable download after the display deadline or terminal status. The display ending does not cancel a provider payment; keep checking for late success.
- Provide a working Download QR button while the QR is active. Prefer the gateway hosted checkout, which already implements these UI rules. If building an embedded payment screen, implement and test every rule above.

Signed notifications:
- Implement a public HTTPS POST /webhooks/byle endpoint in this app. The owner must add its exact hostname to gateway WEBHOOK_ALLOWED_HOSTS and save the endpoint under Applications → Keys & webhooks. It must be public HTTPS on port 443; redirects and private addresses are rejected. Do not send MyanMyanPay callbacks directly to this app; the gateway handles provider verification.
- Read the exact incoming raw body bytes before JSON parsing, with a 100 KB limit. Headers are Byle-Timestamp (Unix seconds), Byle-Signature (64 hex characters), and Byle-Event-Id. Reject missing/malformed headers and timestamps more than 300 seconds from now. Compute HMAC-SHA256 using GATEWAY_WEBHOOK_SECRET over timestamp + '.' + exact raw body bytes, and compare decoded signatures in constant time. Do not verify a reserialized JSON body. Reject invalid signatures with 401.
- After verification, parse {"id":"event-uuid","type":"payment.status_changed","createdAt":"ISO timestamp","data":{"id":"payment-uuid","orderId":"order-1049","amount":"25000","currency":"MMK","status":"SUCCESS"}}. Require body id to match Byle-Event-Id and type to equal payment.status_changed. Payment API uses order_id; notification data uses orderId.
- In one app-database transaction, deduplicate event.id with a unique constraint, lock the matching local order, verify saved payment id, order ID, amount, and MMK currency, and update/fulfill exactly once only on SUCCESS. Commit event receipt and order changes together. Acknowledge previously processed events with 2xx; return non-2xx after a processing failure so it retries. For external fulfillment, use the app's durable outbox/idempotent job mechanism. Never trust a redirect, QR display, or browser claim as proof of payment.
- Events may be duplicated or arrive out of order. Retries retain the same event ID/body but receive fresh timestamps/signatures; automatic delivery makes up to ten attempts. Never downgrade a paid order on a late PENDING event; query the gateway if uncertain. Handle CREATING, PENDING, SUCCESS, FAILED, EXPIRED, CANCELLED, and REFUNDED deliberately. Refunds follow the app's policy; this gateway has no refund-initiation endpoint. Rotating webhook configuration creates a new secret; retain old verification secrets while queued deliveries drain.

Deliver a working checkout action, authenticated order-status UI with preparing/pending/paid/failure states, webhook endpoint, required database migration, environment example, and integration documentation. Test authentication/order ownership, trusted amounts, stable-order retries, raw-body signature verification, stale/tampered events, duplicate/out-of-order delivery, transaction rollback/retry, and exactly-once fulfillment. Run the app's relevant checks. Document the exact webhook URL and owner setup steps. Do not claim real payments work until a merchant sandbox payment, gateway callback, app notification, and fulfillment have been verified; missing merchant credentials are a setup blocker, never a reason to add fake success behavior.

Gateway reference documentation (private repository; use the owner's existing GitHub access):
https://github.com/byarlaydev/ByleGateway/blob/main/docs/INTEGRATION.md
https://github.com/byarlaydev/ByleGateway/blob/main/docs/API.md
If you cannot access these references, use the contract above and report any unresolved ambiguity before moving real money.`;
}
