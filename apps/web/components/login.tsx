"use client";
import { useState } from "react";
export default function Login() {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Sign-in failed");
      window.location.replace("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-intro">
        <a className="brand" href="/login">
          <span className="brand-mark">
            b<span>.</span>
          </span>
          <span>
            Byle<span className="brand-sub">GATEWAY</span>
          </span>
        </a>
        <div className="eyebrow">YOUR PRIVATE PAYMENT WORKSPACE</div>
        <h1>
          One home for
          <br />
          your payments.
        </h1>
        <p>
          Manage your applications, follow each payment, and keep your
          integrations running.
        </p>
        <div className="login-footnote">
          Next.js · NestJS · PostgreSQL
          <br />
          Payments processed by MyanMyanPay
        </div>
      </section>
      <section className="panel login-card">
        <div className="eyebrow">OWNER ACCESS</div>
        <h2>Sign in to your gateway.</h2>
        <p>Your applications and payment history are private.</p>
        <form onSubmit={submit}>
          <label className="form-label">
            Owner password
            <input
              autoFocus
              required
              type="password"
              autoComplete="current-password"
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your owner password"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-help">
          Use the owner password configured on your server. If you are setting
          up this gateway for the first time, follow the installation guide in
          the project README.
        </p>
      </section>
    </main>
  );
}
