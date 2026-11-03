"use client";
import { useEffect, useState } from "react";
import type { App, Payment } from "./models";
async function request(path: string, method = "GET", body?: unknown) {
  const res = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (res.status === 401) window.location.replace("/login");
  if (!res.ok) throw new Error(data.message || "Request failed");
  return data;
}
export function AppTools({
  app,
  onChange,
  onSecret,
  onError,
}: {
  app: App;
  onChange: () => Promise<void>;
  onSecret: (secret: string) => void;
  onError: (message: string) => void;
}) {
  const [url, setUrl] = useState(app.webhook_url || ""),
    [busy, setBusy] = useState(false);
  async function rotate() {
    if (
      !confirm(
        `Replace ${app.name}'s API key? The old key stops working immediately; payment history stays with this app.`,
      )
    )
      return;
    setBusy(true);
    try {
      const data = await request(`admin/apps/${app.id}/rotate-key`, "POST");
      onSecret(data.key);
      await onChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await request(`admin/apps/${app.id}/webhook`, "POST", {
        url,
      });
      if (data.secret) onSecret(data.secret);
      await onChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="app-tools">
      <summary>Keys & webhooks</summary>
      <button className="secondary" disabled={busy} onClick={rotate}>
        Rotate API key
      </button>
      <form onSubmit={save}>
        <label>
          Webhook URL
          <input
            aria-label={`Webhook URL for ${app.name}`}
            type="url"
            placeholder="https://your-app.com/webhooks/byle"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <p>
          Saving generates a new signing secret. Empty the URL to disable future
          notifications. Queued deliveries keep their original destination and
          secret.
        </p>
        <button className="secondary" disabled={busy}>
          Save webhook
        </button>
      </form>
    </details>
  );
}
export function PaymentTimeline({
  payment,
  onError,
}: {
  payment: Payment;
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<{
      events: {
        id: string;
        kind: string;
        data: Record<string, unknown>;
        created_at: string;
      }[];
      deliveries: {
        id: string;
        state: string;
        attempts: number;
        last_status: number | null;
        last_error: string | null;
      }[];
    }>({ events: [], deliveries: [] }),
    [busy, setBusy] = useState(false);
  async function load() {
    setData(await request(`admin/payments/${payment.id}/events`));
  }
  useEffect(() => {
    load().catch((e) => onError(e.message));
  }, [payment.id, payment.status]);
  async function resend(id: string) {
    setBusy(true);
    try {
      await request(`admin/deliveries/${id}/resend`, "POST");
      await load();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="timeline">
      <h3>Payment timeline</h3>
      {
        <button
          className="secondary"
          onClick={() => load().catch((e) => onError(e.message))}
        >
          Reload history
        </button>
      }
      {
        <>
          {data.events.length === 0 && (
            <p>
              No recorded events. Older payments acquire events when reconciled.
            </p>
          )}
          <ol>
            {data.events.map((e) => (
              <li key={e.id}>
                <strong>
                  {e.kind.replaceAll(".", " · ").replaceAll("_", " ")}
                </strong>
                <time>
                  {new Date(e.created_at).toLocaleString("en-GB", {
                    timeZone: "Asia/Yangon",
                  })}
                </time>
                <pre>{JSON.stringify(e.data, null, 2)}</pre>
              </li>
            ))}
          </ol>
          <h3>Webhook deliveries</h3>
          {!data.deliveries.length && (
            <p>No notifications queued for this payment.</p>
          )}
          {data.deliveries.map((d) => (
            <div className="delivery" key={d.id}>
              <strong>{d.state}</strong>
              <p>
                {d.attempts} attempts · HTTP {d.last_status || "no response"}
                {d.last_error ? ` · ${d.last_error}` : ""}
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => resend(d.id)}
              >
                Resend notification
              </button>
            </div>
          ))}
        </>
      }
      {payment.checkout_url && (
        <a
          className="secondary"
          href={payment.checkout_url}
          target="_blank"
          rel="noreferrer"
        >
          Open hosted checkout
        </a>
      )}
    </div>
  );
}
export function SetupChecklist() {
  const [checks, setChecks] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    request("admin/setup")
      .then(setChecks)
      .catch((e) => setError(e.message));
  }, []);
  const items = [
    ["database", "PostgreSQL connection"],
    ["worker", "Worker heartbeat (last two minutes)"],
    ["credentials", "Provider credentials present"],
    ["httpsCallback", "HTTPS callback configured"],
    ["checkoutOrigin", "HTTPS checkout configured"],
    ["webhookEncryption", "Webhook encryption key configured"],
    ["providerVerified", "Signed provider callback received"],
  ];
  return (
    <section className="panel setup-checklist">
      <div className="card-heading">
        <div>
          <h2>Getting ready to accept payments</h2>
          <p>
            {`Environment: ${checks?.mode || "checking"} · Presence checks do not prove merchant approval.`}
          </p>
        </div>
      </div>
      {
        <button
          className="secondary setup-refresh"
          onClick={() =>
            request("admin/setup")
              .then((data) => {
                setChecks(data);
                setError("");
              })
              .catch((e) => setError(e.message))
          }
        >
          Run checks again
        </button>
      }
      {error && <p role="alert">{error}</p>}
      {items.map(([key, label]) => (
        <div className="setting-row" key={key}>
          <span>{label}</span>
          <strong className={checks?.[key] ? "check-ok" : ""}>
            {checks?.[key] ? "Passed" : checks ? "Action needed" : "Checking…"}
          </strong>
        </div>
      ))}
      {checks?.lastVerifiedCallback ? (
        <p className="setup-last">
          Last verified callback:{" "}
          {new Date(String(checks.lastVerifiedCallback)).toLocaleString(
            "en-GB",
            { timeZone: "Asia/Yangon" },
          )}
          . Confirm the full order in your app before going live.
        </p>
      ) : null}
    </section>
  );
}
