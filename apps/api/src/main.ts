import "reflect-metadata";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
  Req,
  Query,
  Res,
  UnauthorizedException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomBytes, randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { RawBodyRequest } from "@nestjs/common";
import { db } from "./db";
import { assertSame, equal, hash, paymentInput, publicHttpsOrigin, verifyCallback } from "./rules";
import { provider, providerMode, upstream, providerReference, gatewayReference } from "./provider";
import { checkout, event, find, reconcile, uuid } from "./payments";
import { startWorker } from "./worker";
import { seal, approveWebhookUrl } from "./webhooks";
const owner = (req: Request) => {
  if (
    !process.env.OWNER_TOKEN ||
    !equal(req.headers.authorization || "", `Bearer ${process.env.OWNER_TOKEN}`)
  )
    throw new UnauthorizedException();
};
async function appAuth(req: Request) {
  const key = req.headers.authorization?.replace(/^Bearer /, "") || "";
  const { rows } = await db.query(
    "SELECT id FROM apps WHERE key_hash=$1 AND active=true",
    [hash(key)],
  );
  if (!rows[0]) throw new UnauthorizedException();
  return rows[0].id as string;
}

const attentionSql = `(p.last_error IS NOT NULL OR (p.status IN ('CREATING','PENDING') AND p.created_at<now()-interval '30 minutes') OR EXISTS(SELECT 1 FROM webhook_deliveries d WHERE d.payment_id=p.id AND d.state='FAILED'))`;
const reportWhere = `p.created_at>=now()-make_interval(days=>$1::int) AND ($2::uuid IS NULL OR p.app_id=$2) AND ($3='' OR strpos(lower(p.order_id||' '||a.name||' '||p.id::text),lower($3))>0) AND ($4='' OR p.status=$4) AND (NOT $5 OR ${attentionSql})`;
function reportFilters(q: Record<string, string>) {
  const days = Number(q.days || 7),
    page = Number(q.page || 1),
    limit = Number(q.limit || 25);
  if (
    ![7, 30, 365].includes(days) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 100000 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    String(q.search || "").length > 200
  )
    throw new BadRequestException("Invalid report filters");
  const status = q.status || "";
  if (
    status &&
    ![
      "CREATING",
      "PENDING",
      "SUCCESS",
      "FAILED",
      "EXPIRED",
      "CANCELLED",
      "REFUNDED",
    ].includes(status)
  )
    throw new BadRequestException("Invalid status");
  return {
    days,
    page,
    limit,
    app: q.app && q.app !== "all" ? uuid(q.app) : null,
    search: q.search || "",
    status,
    attention: q.attention === "true",
  };
}

@Controller()
class GatewayController {
  @Post("admin/sessions") async createSession(
    @Req() req: Request,
    @Body() body: { credentialVersion?: unknown },
  ) {
    owner(req);
    if (
      typeof body?.credentialVersion !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.credentialVersion)
    )
      throw new BadRequestException("Invalid credential revision");
    const token = randomBytes(32).toString("hex");
    await db.query(
      "DELETE FROM owner_sessions WHERE expires_at<=now() OR credential_version<>$1",
      [body.credentialVersion],
    );
    await db.query(
      "INSERT INTO owner_sessions(token_hash,credential_version) VALUES($1,$2)",
      [hash(token), body.credentialVersion],
    );
    return { token };
  }
  @Get("admin/sessions/current") async session(@Req() req: Request) {
    owner(req);
    const token = String(req.headers["x-owner-session"] || ""),
      version = String(req.headers["x-credential-version"] || "");
    if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(version))
      throw new UnauthorizedException();
    const { rowCount } = await db.query(
      "SELECT 1 FROM owner_sessions WHERE token_hash=$1 AND credential_version=$2 AND expires_at>now()",
      [hash(token), version],
    );
    if (!rowCount) throw new UnauthorizedException();
    return { authenticated: true };
  }
  @Delete("admin/sessions/current") async deleteSession(@Req() req: Request) {
    owner(req);
    await db.query("DELETE FROM owner_sessions WHERE token_hash=$1", [
      hash(String(req.headers["x-owner-session"] || "")),
    ]);
    return { revoked: true };
  }
  @Get("health") async health() {
    await db.query("SELECT 1");
    return { status: "ok" };
  }
  @Get("admin/overview") async overview(
    @Req() req: Request,
    @Query() query: Record<string, string>,
  ) {
    owner(req);
    const filters = reportFilters(query);
    const args = [
      filters.days,
      filters.app,
      filters.search,
      filters.status,
      filters.attention,
    ];
    const [apps, summary, count, payments, activity] = await Promise.all([
      db.query(
        "SELECT id,name,key_prefix,active,created_at,webhook_url,(SELECT count(*) FROM payments WHERE app_id=apps.id) AS payment_count FROM apps ORDER BY created_at DESC",
      ),
      db.query(
        `SELECT count(*) AS total,count(*) FILTER(WHERE status='SUCCESS') AS successful,COALESCE(sum(amount) FILTER(WHERE status='SUCCESS'),0)::text AS volume,count(*) FILTER(WHERE status IN ('CREATING','PENDING')) AS pending FROM payments WHERE created_at>=now()-make_interval(days=>$1::int) AND ($2::uuid IS NULL OR app_id=$2)`,
        args.slice(0, 2),
      ),
      db.query(
        `SELECT count(*) AS total FROM payments p JOIN apps a ON a.id=p.app_id WHERE ${reportWhere}`,
        args,
      ),
      db.query(
        `SELECT p.*,a.name AS app_name FROM payments p JOIN apps a ON a.id=p.app_id WHERE ${reportWhere} ORDER BY p.created_at DESC,p.id DESC LIMIT $6 OFFSET $7`,
        [...args, filters.limit, (filters.page - 1) * filters.limit],
      ),
      db.query(
        `SELECT LEAST(6,floor(extract(epoch FROM(now()-created_at))/($1::numeric*86400/7)))::int AS bucket,COALESCE(sum(amount),0)::text AS amount FROM payments WHERE status='SUCCESS' AND created_at>=now()-make_interval(days=>$1::int) AND ($2::uuid IS NULL OR app_id=$2) GROUP BY bucket`,
        args.slice(0, 2),
      ),
    ]);
    return {
      apps: apps.rows,
      payments: payments.rows.map(checkout),
      summary: summary.rows[0],
      total: Number(count.rows[0].total),
      page: filters.page,
      limit: filters.limit,
      activity: Array.from({ length: 7 }, (_, i) =>
        Number(activity.rows.find((r) => r.bucket === 6 - i)?.amount || 0),
      ),
      configured: Boolean(
        process.env.MMPAY_SECRET_KEY &&
        process.env.MMPAY_APP_ID &&
        process.env.MMPAY_PUBLISHABLE_KEY &&
        process.env.MMPAY_API_BASE_URL &&
        process.env.PUBLIC_API_URL,
      ),
      mode: providerMode(),
    };
  }
  @Get("admin/payments/export") async exportPayments(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, string>,
  ) {
    owner(req);
    const f = reportFilters(query);
    const client = await db.connect();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="byle-transactions.csv"',
    );
    const csv = (value: unknown) =>
      '"' +
      String(value ?? "")
        .replace(/^\s*[=+@-]/, "'$&")
        .replaceAll('"', '""') +
      '"';
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      res.write("Order,Application,Amount,Currency,Status,Created\n");
      let cursor: string[] | null = null;
      while (!res.destroyed) {
        const {
          rows,
        }: {
          rows: {
            order_id: string;
            name: string;
            amount: string;
            currency: string;
            status: string;
            created_at: Date;
            id: string;
          }[];
        } = await client.query(
          `SELECT p.order_id,a.name,p.amount,p.currency,p.status,p.created_at,p.id FROM payments p JOIN apps a ON a.id=p.app_id WHERE ${reportWhere} AND ($6::timestamptz IS NULL OR (p.created_at,p.id)<($6::timestamptz,$7::uuid)) ORDER BY p.created_at DESC,p.id DESC LIMIT 1000`,
          [
            f.days,
            f.app,
            f.search,
            f.status,
            f.attention,
            cursor?.[0] || null,
            cursor?.[1] || null,
          ],
        );
        if (!rows.length) break;
        for (const p of rows) {
          if (res.destroyed) break;
          if (
            !res.write(
              [
                p.order_id,
                p.name,
                p.amount,
                p.currency,
                p.status,
                p.created_at.toISOString(),
              ]
                .map(csv)
                .join(",") + "\n",
            )
          )
            await new Promise<void>((resolve) => {
              const done = () => {
                res.off("drain", done);
                res.off("close", done);
                resolve();
              };
              res.once("drain", done);
              res.once("close", done);
            });
        }
        const last: { created_at: Date; id: string } = rows[rows.length - 1];
        cursor = [last.created_at.toISOString(), last.id];
      }
      await client.query("COMMIT");
      res.end();
    } catch (e) {
      await client.query("ROLLBACK");
      res.destroy();
    } finally {
      client.release();
    }
  }
  @Get("admin/setup") async setup(@Req() req: Request) {
    owner(req);
    await db.query("SELECT 1");
    const {
      rows: [runtime],
    } = await db.query(
      "SELECT last_tick_at FROM gateway_runtime WHERE id='worker'",
    );
    const {
      rows: [callbacks],
    } = await db.query(
      "SELECT max(created_at) AS last_at FROM payment_events WHERE kind='callback.verified'",
    );
    return {
      database: true,
      worker: Boolean(
        runtime &&
        Date.now() - new Date(runtime.last_tick_at).getTime() < 120000,
      ),
      credentials: Boolean(
        process.env.MMPAY_APP_ID &&
        process.env.MMPAY_SECRET_KEY &&
        process.env.MMPAY_PUBLISHABLE_KEY &&
        process.env.MMPAY_API_BASE_URL,
      ),
      httpsCallback: publicHttpsOrigin(process.env.PUBLIC_API_URL),
      checkoutOrigin: publicHttpsOrigin(process.env.CHECKOUT_ORIGIN),
      webhookEncryption: Boolean(
        process.env.WEBHOOK_ENCRYPTION_KEY &&
        process.env.WEBHOOK_ENCRYPTION_KEY.length >= 32 &&
        !process.env.WEBHOOK_ENCRYPTION_KEY.startsWith("replace-"),
      ),
      lastVerifiedCallback: callbacks.last_at,
      mode: providerMode(),
      providerVerified: Boolean(callbacks.last_at),
    };
  }
  @Get("admin/payments/:id/events") async events(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    owner(req);
    await find(id);
    const [events, deliveries] = await Promise.all([
      db.query(
        "SELECT * FROM payment_events WHERE payment_id=$1 ORDER BY created_at DESC LIMIT 200",
        [id],
      ),
      db.query(
        "SELECT id,event_id,state,attempts,last_status,last_error,next_attempt_at,delivered_at FROM webhook_deliveries WHERE payment_id=$1 ORDER BY created_at DESC",
        [id],
      ),
    ]);
    return { events: events.rows, deliveries: deliveries.rows };
  }
  @Post("admin/deliveries/:id/resend") @HttpCode(200) async resend(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    owner(req);
    const { rows } = await db.query(
      "UPDATE webhook_deliveries SET state='PENDING',attempts=0,next_attempt_at=now(),last_error=NULL WHERE id=$1 AND (lease_until IS NULL OR lease_until<now()) RETURNING payment_id",
      [uuid(id)],
    );
    if (!rows[0])
      throw new ConflictException("Delivery unavailable or in progress");
    await event(rows[0].payment_id, "webhook.resend_requested", {
      deliveryId: id,
    });
    return { queued: true };
  }
  @Post("admin/apps/:id/rotate-key") async rotate(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    owner(req);
    const key = `bg_${randomBytes(32).toString("hex")}`;
    const { rows } = await db.query(
      "UPDATE apps SET key_hash=$2,key_prefix=$3,active=true WHERE id=$1 RETURNING id,name,key_prefix,active,created_at",
      [uuid(id), hash(key), key.slice(0, 11)],
    );
    if (!rows[0]) throw new NotFoundException();
    return { ...rows[0], key };
  }
  @Post("admin/apps/:id/webhook") async webhookConfig(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: { url?: unknown },
  ) {
    owner(req);
    uuid(id);
    const url = body?.url === "" ? null : await approveWebhookUrl(body?.url);
    const secret = url ? `whsec_${randomBytes(32).toString("hex")}` : null;
    const { rows } = await db.query(
      "UPDATE apps SET webhook_url=$2,webhook_secret=$3 WHERE id=$1 RETURNING id,webhook_url",
      [id, url, secret ? seal(secret) : null],
    );
    if (!rows[0]) throw new NotFoundException();
    return { ...rows[0], secret };
  }
  @Get("public/checkout/:token") async publicCheckout(
    @Param("token") token: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new NotFoundException();
    const {
      rows: [payment],
    } = await db.query(
      `SELECT p.order_id,p.amount,p.currency,p.status,CASE WHEN p.checkout_expires_at>now() AND p.status IN ('CREATING','PENDING') THEN p.qr ELSE NULL END AS qr,p.description,p.checkout_expires_at,a.name AS app_name FROM payments p JOIN apps a ON a.id=p.app_id WHERE p.checkout_token=$1`,
      [token],
    );
    if (!payment) throw new NotFoundException();
    return { ...payment, mode: providerMode() };
  }
  @Post("admin/apps") async createApp(
    @Req() req: Request,
    @Body() body: { name?: unknown },
  ) {
    owner(req);
    if (
      typeof body?.name !== "string" ||
      !body.name.trim() ||
      body.name.length > 60
    )
      throw new BadRequestException("App name must be 1–60 characters");
    const key = `bg_${randomBytes(32).toString("hex")}`;
    const { rows } = await db.query(
      "INSERT INTO apps(id,name,key_hash,key_prefix) VALUES($1,$2,$3,$4) RETURNING id,name,key_prefix,active,created_at",
      [randomUUID(), body.name.trim(), hash(key), key.slice(0, 11)],
    );
    return { ...rows[0], key };
  }
  @Delete("admin/apps/:id/key") async revoke(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    owner(req);
    const result = await db.query(
      "UPDATE apps SET active=false WHERE id=$1 RETURNING id",
      [uuid(id)],
    );
    if (!result.rowCount) throw new NotFoundException();
    return { revoked: true };
  }
  @Post("v1/payments") async createPayment(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ) {
    const appId = await appAuth(req);
    const input = paymentInput(body);
    if (
      process.env.NODE_ENV === "production" &&
      (!publicHttpsOrigin(process.env.PUBLIC_API_URL) ||
        !publicHttpsOrigin(process.env.CHECKOUT_ORIGIN))
    )
      throw new ServiceUnavailableException(
        "Configure your real HTTPS API and checkout origins before creating payments",
      );
    const sdk = provider();
    const id = randomUUID();
    const { rows } = await db.query(
      "INSERT INTO payments(id,app_id,order_id,amount,description,checkout_token) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(app_id,order_id) DO NOTHING RETURNING *",
      [
        id,
        appId,
        input.orderId,
        input.amount,
        input.description,
        randomBytes(32).toString("hex"),
      ],
    );
    if (!rows[0]) {
      const {
        rows: [existing],
      } = await db.query(
        "SELECT * FROM payments WHERE app_id=$1 AND order_id=$2",
        [appId, input.orderId],
      );
      assertSame(existing, input);
      return checkout(existing);
    }
    await event(id, "payment.created", {
      amount: input.amount,
      currency: "MMK",
    });
    await event(id, "provider.create_started");
    // Preserve CREATING after an ambiguous failure: generating another order could charge twice.
    const result = await upstream(() =>
      sdk.pay({
        orderId: providerReference(id),
        amount: input.amount,
        currency: "MMK",
        customMessage: input.description,
        callbackUrl: `${process.env.PUBLIC_API_URL}/webhooks/mmpay`,
      }),
    ).catch(async (error) => {
      await event(id, "provider.create_failed", {
        message: "Provider request failed; reconciliation scheduled",
      });
      await db.query(
        "UPDATE payments SET last_error='Creation outcome unknown; reconciliation scheduled' WHERE id=$1",
        [id],
      );
      throw error;
    });
    if (
      result.orderId !== providerReference(id) ||
      Number(result.amount) !== input.amount ||
      !result.qr
    ) {
      await event(id, "provider.create_failed", {
        message: "Invalid provider response; reconciliation scheduled",
      });
      await db.query(
        "UPDATE payments SET last_error='Invalid creation response; reconciliation scheduled' WHERE id=$1",
        [id],
      );
      throw new ServiceUnavailableException(
        "Invalid provider response; reconcile this payment",
      );
    }
    await db.query(
      "UPDATE payments SET qr=$2,status=CASE WHEN status='CREATING' THEN 'PENDING' ELSE status END,updated_at=now() WHERE id=$1",
      [id, result.qr],
    );
    await event(id, "provider.create_completed", {
      status: result.status,
      vendorQrRefId: result.vendorQrRefId,
    });
    return checkout(await find(id, appId));
  }
  @Get("v1/payments/:id") async getPayment(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return checkout(await find(id, await appAuth(req)));
  }
  @Post("v1/payments/:id/refresh") @HttpCode(200) async refresh(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return checkout(await reconcile(id, await appAuth(req)));
  }
  @Post("admin/payments/:id/refresh") @HttpCode(200) async adminRefresh(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    owner(req);
    return checkout(await reconcile(id));
  }
  @Post("webhooks/mmpay") @HttpCode(200) async callback(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: { orderId?: string },
  ) {
    // Never trust callback status: retrieve the authoritative record through the signed provider API.
    if (typeof body?.orderId !== "string")
      throw new BadRequestException("Missing orderId");
    const id = gatewayReference(body.orderId);
    if (
      !req.rawBody ||
      !verifyCallback(
        req.rawBody.toString("utf8"),
        String(req.headers["x-mmpay-nonce"] || ""),
        String(req.headers["x-mmpay-signature"] || ""),
        process.env.MMPAY_SECRET_KEY || "",
      )
    )
      throw new UnauthorizedException("Invalid provider signature");
    await find(id);
    await event(id, "callback.verified");
    await reconcile(id);
    return { received: true };
  }
}
@Module({ controllers: [GatewayController] })
class AppModule {}
async function bootstrap() {
  if (
    !process.env.DATABASE_URL ||
    !process.env.OWNER_TOKEN ||
    process.env.OWNER_TOKEN.length < 32 ||
    process.env.OWNER_TOKEN.startsWith("replace-")
  )
    throw new Error(
      "Set DATABASE_URL and a random OWNER_TOKEN of at least 32 characters",
    );
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  if (process.env.WORKER_ENABLED !== "false") {
    const stop = startWorker();
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }
  // shortcut: one API process uses local rate buckets; use a shared limiter before adding replicas.
  const buckets = new Map<string, number>();
  let windowStart = Date.now();
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use((req: Request, res: Response, next: () => void) => {
    if (req.path === "/health") {
      next();
      return;
    }
    if (Date.now() - windowStart >= 60000) {
      buckets.clear();
      windowStart = Date.now();
    }
    const key = req.ip || "unknown";
    const count = (buckets.get(key) || 0) + 1;
    buckets.set(key, count);
    if (count > 600) {
      res.setHeader("Retry-After", "60");
      res
        .status(429)
        .json({ statusCode: 429, message: "Too many requests; retry later" });
      return;
    }
    next();
  });
  await app.listen(
    Number(process.env.PORT || 4000),
    process.env.API_BIND_ADDRESS || "127.0.0.1",
  );
}
bootstrap().catch(() => {
  console.error("API startup failed. Check configuration and port.");
  process.exitCode = 1;
});
