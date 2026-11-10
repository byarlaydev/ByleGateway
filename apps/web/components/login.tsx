"use client";
import { useState } from "react";
export default function Login() {
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [mfaRequired, setMfaRequired] = useState(false),
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
        body: JSON.stringify({ password, code: mfaRequired ? code : undefined }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Sign-in failed");
      if (data.mfaRequired) {
        setMfaRequired(true);
        setBusy(false);
        return;
      }
      window.location.replace("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="panel login-card">
        <a className="brand" href="/login">
          <span className="brand-mark">
            b<span>.</span>
          </span>
          <span>
            Byle<span className="brand-sub">GATEWAY</span>
          </span>
        </a>
        <h1>Sign in</h1>
        <p>Owner access to your payment workspace.</p>
        <form onSubmit={submit}>
          <label className="form-label">
            Owner password
            <input
              autoFocus={!mfaRequired}
              required
              type="password"
              autoComplete="current-password"
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your owner password"
              readOnly={mfaRequired}
            />
          </label>
          {mfaRequired && (
            <label className="form-label">
              Authenticator code
              <input
                autoFocus
                required
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={100}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6-digit code or recovery code"
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : mfaRequired ? "Verify code" : "Sign in"}
          </button>
        </form>
        <p className="login-help">
          {mfaRequired
            ? "Enter the 6-digit code from your authenticator app, or one of your recovery codes."
            : "Use the owner password configured on your server. If you are setting up this gateway for the first time, follow the installation guide in the project README."}
        </p>
      </section>
    </main>
  );
}
