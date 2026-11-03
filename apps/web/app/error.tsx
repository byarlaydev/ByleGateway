"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="checkout-shell">
      <section className="panel checkout-card">
        <div className="eyebrow">BYLE GATEWAY</div>
        <h1>Your workspace is temporarily unavailable.</h1>
        <p>
          Check that the gateway API and PostgreSQL are running, then try again.
        </p>
        <button className="primary" onClick={reset}>
          Try again
        </button>
        <a className="text-link" href="/login">
          Return to sign in
        </a>
      </section>
    </main>
  );
}
