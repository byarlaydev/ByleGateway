import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { validTransition } from "./rules";
import { provider, upstream, providerReference } from "./provider";
export const uuid = (id: string) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new BadRequestException("Invalid identifier");
  return id;
};
export async function event(
  paymentId: string,
  kind: string,
  data: object = {},
  client: Pick<typeof db, "query"> = db,
) {
  const id = randomUUID();
  await client.query(
    "INSERT INTO payment_events(id,payment_id,kind,data) VALUES($1,$2,$3,$4)",
    [id, paymentId, kind, JSON.stringify(data)],
  );
  return id;
}
export function checkout(payment: Record<string, any>) {
  const { checkout_token, ...record } = payment;
  return {
    ...record,
    checkout_expires_at: new Date(Math.min(new Date(payment.checkout_expires_at).getTime(), new Date(payment.created_at).getTime() + 15 * 60000)).toISOString(),
    checkout_url: checkout_token
      ? `${(process.env.CHECKOUT_ORIGIN || "http://127.0.0.1:3000").replace(/\/$/, "")}/checkout/${checkout_token}`
      : null,
  };
}
export async function find(id: string, appId?: string) {
  const { rows } = await db.query(
    "SELECT * FROM payments WHERE id=$1 AND ($2::uuid IS NULL OR app_id=$2)",
    [uuid(id), appId || null],
  );
  if (!rows[0]) throw new NotFoundException("Payment not found");
  return rows[0];
}
export async function reconcile(id: string, appId?: string) {
  await find(id, appId);
  try {
    return await reconcilePayment(id, appId);
  } catch (error) {
    const message =
      error instanceof ConflictException
        ? "Provider payment details do not match; review required"
        : "Provider lookup failed; retry scheduled";
    await db.query("UPDATE payments SET last_error=$2 WHERE id=$1", [
      id,
      message,
    ]);
    await event(id, "reconciliation.failed", { message });
    throw error;
  }
}
async function reconcilePayment(id: string, appId?: string) {
  const payment = await find(id, appId);
  const result = await upstream(() =>
    provider().get({ orderId: providerReference(payment.id), nonce: Date.now().toString() }),
  );
  if (
    ![
      "PENDING",
      "SUCCESS",
      "FAILED",
      "EXPIRED",
      "CANCELLED",
      "REFUNDED",
    ].includes(result?.status)
  )
    throw new ServiceUnavailableException("Unknown provider payment status");
  if (
    !result ||
    result.orderId !== providerReference(payment.id) ||
    Number(result.amount) !== Number(payment.amount) ||
    ("currency" in result && result.currency !== "MMK")
  )
    throw new ConflictException("Provider payment details do not match");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const {
      rows: [current],
    } = await client.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    if (validTransition(current.status, result.status)) {
      await client.query(
        "UPDATE payments SET status=$2, qr=COALESCE($3,qr), updated_at=now(),last_checked_at=now(),last_error=NULL,check_attempts=0,check_lease_until=NULL,next_check_at=now()+interval '60 seconds' WHERE id=$1",
        [id, result.status, result.qr || null],
      );
      if (current.status !== result.status) {
        const eventId = await event(
          id,
          "payment.status_changed",
          { from: current.status, to: result.status },
          client,
        );
        const {
          rows: [app],
        } = await client.query(
          "SELECT webhook_url,webhook_secret FROM apps WHERE id=$1",
          [current.app_id],
        );
        if (app.webhook_url && app.webhook_secret) {
          const payload = JSON.stringify({
            id: eventId,
            type: "payment.status_changed",
            createdAt: new Date().toISOString(),
            data: {
              id: current.id,
              orderId: current.order_id,
              amount: current.amount,
              currency: current.currency,
              status: result.status,
            },
          });
          await client.query(
            "INSERT INTO webhook_deliveries(id,event_id,app_id,payment_id,url,secret,payload) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              randomUUID(),
              eventId,
              current.app_id,
              id,
              app.webhook_url,
              app.webhook_secret,
              payload,
            ],
          );
        }
      }
    } else {
      await client.query(
        "UPDATE payments SET last_checked_at=now(),check_lease_until=NULL,next_check_at=now()+interval '1 hour',last_error=CASE WHEN $2='PENDING' THEN NULL ELSE 'Provider reported a conflicting terminal state; review merchant portal' END WHERE id=$1",
        [id, result.status],
      );
      await event(
        id,
        "payment.transition_ignored",
        { from: current.status, to: result.status },
        client,
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return find(id, appId);
}
