import { db } from "./db";
import { event, reconcile } from "./payments";
import { sendWebhook } from "./webhooks";
export async function tick(deliver: typeof sendWebhook = sendWebhook) {
  await db.query(
    "INSERT INTO gateway_runtime(id,last_tick_at) VALUES('worker',now()) ON CONFLICT(id) DO UPDATE SET last_tick_at=now()",
  );
  const { rows: payments } = await db.query(
    `UPDATE payments SET check_lease_until=now()+interval '90 seconds' WHERE id IN (SELECT id FROM payments WHERE status IN ('CREATING','PENDING') AND next_check_at<=now() AND (check_lease_until IS NULL OR check_lease_until<now()) AND created_at>now()-interval '7 days' ORDER BY next_check_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING id`,
  );
  await Promise.all(
    payments.map(async (p) => {
      try {
        await reconcile(p.id);
      } catch {
        await db.query(
          "UPDATE payments SET check_attempts=check_attempts+1,last_error='Provider reconciliation failed; inspect merchant portal',last_checked_at=now(),next_check_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(check_attempts,7)))::int),check_lease_until=NULL WHERE id=$1",
          [p.id],
        );
      }
    }),
  );
  const { rows: deliveries } = await db.query(
    `UPDATE webhook_deliveries SET lease_until=now()+interval '60 seconds',lease_id=gen_random_uuid() WHERE id IN (SELECT id FROM webhook_deliveries WHERE state='PENDING' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING *`,
  );
  await Promise.all(
    deliveries.map(async (d) => {
      let status: number | null = null;
      try {
        status = await deliver(d.url, d.secret, d.payload, d.event_id);
      } catch {}
      const ok = status !== null && status >= 200 && status < 300;
      const saved = await db.query(
        `UPDATE webhook_deliveries SET attempts=attempts+1,state=CASE WHEN $2 THEN 'DELIVERED' WHEN attempts+1>=10 THEN 'FAILED' ELSE 'PENDING' END,last_status=$3,last_error=CASE WHEN $2 THEN NULL ELSE 'Endpoint did not acknowledge delivery' END,delivered_at=CASE WHEN $2 THEN now() ELSE NULL END,next_attempt_at=now()+make_interval(secs=>LEAST(3600,30*power(2,LEAST(attempts,7)))::int),lease_until=NULL,lease_id=NULL WHERE id=$1 AND lease_id=$4`,
        [d.id, ok, status, d.lease_id],
      );
      if (saved.rowCount)
        await event(d.payment_id, "webhook.attempt", {
          deliveryId: d.id,
          httpStatus: status,
          delivered: ok,
        });
    }),
  );
}
export function startWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await tick();
    } catch {
      console.error("Worker tick failed; will retry");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, 10000);
  timer.unref();
  void run();
  return () => clearInterval(timer);
}
