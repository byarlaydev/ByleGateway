"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
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
          Paste your app’s public HTTPS endpoint on an approved hostname. Saving
          checks its public address and generates a signing secret. Empty the URL to disable future
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
          <strong className={checks?.[key] ? "check-ok" : checks ? "check-warn" : ""}>
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
export function MfaSettings() {
  const [status, setStatus] = useState<{ enabled: boolean; configured: boolean; recoveryRemaining: number } | null>(null),
    [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null),
    [code, setCode] = useState(""),
    [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function load() {
    request("admin/mfa")
      .then(setStatus)
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);
  async function begin() {
    setBusy(true);
    setError("");
    try {
      const data = await request("admin/mfa/begin", "POST");
      const qr = await QRCode.toDataURL(data.uri, { width: 240, margin: 2 });
      setSetup({ ...data, qr });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function enable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await request("admin/mfa/enable", "POST", { code });
      setRecoveryCodes(data.codes);
      setSetup(null);
      setCode("");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    const input = prompt("Enter your current authenticator or recovery code to disable MFA:");
    if (!input) return;
    setBusy(true);
    setError("");
    try {
      await request("admin/mfa/disable", "POST", { code: input });
      setRecoveryCodes(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function regenerateRecovery() {
    const input = prompt("Enter your current authenticator code to regenerate recovery codes:");
    if (!input) return;
    setBusy(true);
    setError("");
    try {
      const data = await request("admin/mfa/recovery", "POST", { code: input });
      setRecoveryCodes(data.codes);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel mfa-settings">
      <div className="card-heading">
        <div>
          <h2>Two-factor authentication</h2>
          <p>Require an authenticator code to sign in, in addition to your owner password.</p>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {!status ? (
        <p>Checking status…</p>
      ) : recoveryCodes ? (
        <div className="mfa-recovery-reveal">
          <span className="eyebrow">SAVE THESE CODES</span>
          <p>
            Each recovery code works once if you lose access to your authenticator
            app. They will not be shown again.
          </p>
          <pre className="secret">{recoveryCodes.join("\n")}</pre>
          <button className="secondary" onClick={() => setRecoveryCodes(null)}>
            I’ve saved these codes
          </button>
        </div>
      ) : !status.configured ? (
        <p>
          Set <code>MFA_ENCRYPTION_KEY</code> (32+ characters) on the server and
          restart to enable two-factor authentication.
        </p>
      ) : status.enabled ? (
        <>
          <div className="setting-row">
            <span>Status</span>
            <strong className="check-ok">Enabled</strong>
          </div>
          <div className="setting-row">
            <span>Unused recovery codes</span>
            <strong>{status.recoveryRemaining}</strong>
          </div>
          <button className="secondary" disabled={busy} onClick={regenerateRecovery}>
            Regenerate recovery codes
          </button>
          <button className="secondary" disabled={busy} onClick={disable}>
            Disable two-factor authentication
          </button>
        </>
      ) : setup ? (
        <form onSubmit={enable} className="mfa-enroll">
          <p>Scan this code with your authenticator app, or enter the secret manually.</p>
          <img src={setup.qr} width={240} height={240} alt="Authenticator setup QR code" />
          <p className="mfa-secret secret">
            Manual entry secret: <code>{setup.secret}</code>
          </p>
          <label>
            Enter the 6-digit code to confirm
            <input
              autoFocus
              required
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
          </label>
          <div className="checkout-action-row">
            <button type="button" className="secondary" onClick={() => setSetup(null)} disabled={busy}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Confirm and enable
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="setting-row">
            <span>Status</span>
            <strong>Not enabled</strong>
          </div>
          <button className="secondary" disabled={busy} onClick={begin}>
            Set up two-factor authentication
          </button>
        </>
      )}
    </section>
  );
}
export function AuditLog() {
  const [entries, setEntries] = useState<
      { id: string; action: string; detail: Record<string, unknown>; created_at: string }[] | null
    >(null),
    [error, setError] = useState("");
  function load() {
    request("admin/audit")
      .then((data) => setEntries(data.entries))
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);
  return (
    <section className="panel audit-log">
      <div className="card-heading">
        <div>
          <h2>Admin activity</h2>
          <p>Recent sign-ins, key rotations, webhook changes and exports on this gateway.</p>
        </div>
        <button className="secondary" onClick={load}>
          Reload
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!entries ? (
        <p>Loading…</p>
      ) : !entries.length ? (
        <p>No recorded activity yet.</p>
      ) : (
        <div className="timeline">
          <ol>
            {entries.map((e) => (
              <li key={e.id}>
                <strong>{e.action.replaceAll(".", " · ").replaceAll("_", " ")}</strong>
                <time>
                  {new Date(e.created_at).toLocaleString("en-GB", { timeZone: "Asia/Yangon" })}
                </time>
                {Object.keys(e.detail).length > 0 && <pre>{JSON.stringify(e.detail, null, 2)}</pre>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
