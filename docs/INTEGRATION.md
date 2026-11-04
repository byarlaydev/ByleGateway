# Integrate an application

For an AI-assisted integration, open **Integration → Copy integration prompt** in the owner dashboard and paste it into the agent working on your app. Preview the full contract before copying. The prompt uses the current dashboard origin (the Railway deployment serves the dashboard and public API together) and contains no secrets. If you run separate dashboard/API domains, replace `GATEWAY_URL` with the public API origin. Supply the app API key and webhook signing secret through your app's backend secret store separately.

## 1. Register and protect your key

Connect to the owner dashboard, add an application, and copy its one-time API key. Keep it in your app backend’s secret store:

```dotenv
GATEWAY_URL=https://payments.your-domain.com
GATEWAY_KEY=bg_your_application_secret
```

The URL is your NestJS API origin, not the dashboard. Never expose an app key, owner token, or webhook signing secret to a browser/mobile bundle. Every app is isolated; rotating a key retains the same app ID and payment history. Rotation immediately invalidates the old key, so deploy the new secret to your app promptly. Revocation blocks API access but does not stop reconciliation or callbacks for existing payments.

## 2. Create an order and payment

Save your order in your app database first. Read its amount from that trusted database, not customer-supplied input. Use a stable order ID on every retry.

```js
export async function createPayment(order) {
  const response = await fetch(`${process.env.GATEWAY_URL}/v1/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GATEWAY_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orderId: order.id,
      amount: order.totalKyat,
      currency: "MMK",
      description: "Digital product order",
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok)
    throw new Error(
      `Gateway returned ${response.status}; preserve the order ID`,
    );
  return response.json();
}
```

Amounts are integers in whole kyat: 25000 means 25,000 MMK. A repeated order with identical details returns the existing record; changing its amount or description returns 409. The gateway sends its own UUID without hyphens (32 hexadecimal characters) to the provider, avoiding collisions between your apps. Public gateway payment IDs keep their UUID format.

## 3. Open hosted checkout

Store `payment.id` against your app’s order. Return `payment.checkout_url` from your backend and navigate the customer there. The checkout shows amount, order reference, MMQR, and current payment status. It polls automatically and stops displaying QR data after a 30-minute window or terminal status. A closed display window does not cancel the provider payment: late payments may still confirm.

Treat checkout URLs as private bearer links. They contain no app API key and cannot reveal another order without its unguessable token. The gateway does not accept arbitrary return URLs; customers return to your app themselves after completion. This avoids introducing open redirects.

For an embedded flow, `payment.qr` is the raw EMVCo string. Render it with your own QR library, not as an image URL. When status is CREATING or QR is null, show a preparing state and wait for reconciliation.

## 4. Receive signed status notifications

1. Add your exact webhook hostname to gateway `WEBHOOK_ALLOWED_HOSTS` and set a separate random `WEBHOOK_ENCRYPTION_KEY`.
2. Restart the gateway.
3. In **Applications → Keys & webhooks**, save your HTTPS endpoint.
4. Copy the one-time `whsec_...` secret into **your app’s** backend configuration.
5. Process events idempotently. Any 2xx acknowledges receipt; non-2xx responses retry.

Signature verification must use the **exact incoming body bytes**, before JSON parsing. For a Node.js backend:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyByleEvent(rawBody, headers, secret) {
  const timestamp = headers["byle-timestamp"];
  const signature = headers["byle-signature"];
  const eventId = headers["byle-event-id"];
  if (
    typeof timestamp !== "string" ||
    !/^\d+$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    typeof signature !== "string" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    typeof eventId !== "string"
  ) {
    throw new Error("Invalid or stale webhook");
  }
  const expected = createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(rawBody)
    .digest("hex");
  if (
    !timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    )
  ) {
    throw new Error("Invalid webhook signature");
  }
  const event = JSON.parse(rawBody.toString("utf8"));
  if (event.id !== eventId || event.type !== "payment.status_changed") {
    throw new Error("Unexpected event");
  }
  return event;
}
```

For Express, mount `express.raw({type:'application/json',limit:'100kb'})` on your webhook route **before** a global `express.json()` middleware. Other frameworks need equivalent raw-body handling. Return 401 for invalid signatures. Never log secrets or raw signature headers.

Within one transaction in **your app database**:

- Insert the event ID into an inbox table with a unique constraint. If it already exists, acknowledge 2xx without repeating fulfillment.
- Find/lock the saved order and verify event payment ID, order ID, amount, and MMK currency against it.
- Fulfill only SUCCESS, once. Do not let a late PENDING event reverse an already paid order. Handle REFUNDED using your app’s refund policy.
- Commit inbox receipt and order change together, then return 2xx. Roll back and return a non-2xx if processing fails.

Notifications are at least once and can arrive out of order; fetch the current payment if uncertain. Each delivery retry has a fresh timestamp/signature but the **same event ID and body**. Ten automatic attempts are allowed, with exponential backoff from 30 seconds up to one hour. Inspect failures in the payment timeline and use **Resend notification** after fixing your app.

Saving a webhook URL again generates a new signing secret for future events. Queued events keep their old URL/secret. Keep the old verification secret available while those deliveries drain, or manually resolve their orders before removing it. An empty URL disables future events without deleting queued history.

## 5. Verify or poll payment status

```js
export async function readPayment(paymentId) {
  const response = await fetch(
    `${process.env.GATEWAY_URL}/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: { Authorization: `Bearer ${process.env.GATEWAY_KEY}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!response.ok)
    throw new Error(`Payment lookup failed: ${response.status}`);
  return response.json();
}
```

You can retain polling as a fallback: your browser polls **your app backend**, which uses its secret to read the gateway. Fulfill only when status is SUCCESS and order ID, amount, currency, and saved payment ID match your order. A displayed QR, checkout redirect, or create response is not proof of payment.

The gateway automatically checks pending/creating payments. It does not regenerate provider payments after an uncertain create. If a create times out, retry the same request to retrieve its gateway ID, then wait or call `POST /v1/payments/:id/refresh`. Check **Needs attention** for persistent failures. Payments older than seven days need manual reconciliation through the owner dashboard or API; investigate unresolved creations in the provider portal before replacing an order.

## 6. Test the complete flow

Use separate sandbox credentials/deployment/database. Create a payment from your app, open hosted checkout, simulate payment in MyanMyanPay’s merchant dashboard, verify a signed callback, watch gateway status become SUCCESS, and confirm your app receives a signed notification and fulfills exactly once. Replay a notification to test deduplication. Temporarily return 503 from your app endpoint, restore it, and verify retry recovery.

Only after this passes should you configure live credentials in a separate deployment and perform a controlled live transaction. The automated local mock test cannot establish merchant connectivity or approval.
