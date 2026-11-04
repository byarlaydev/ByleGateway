"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
type Payment = {
  order_id: string;
  amount: string;
  currency: string;
  status: string;
  qr: string | null;
  description: string;
  checkout_expires_at: string;
  app_name: string;
  mode: string;
};
export default function Checkout({ token }: { token: string }) {
  const [payment, setPayment] = useState<Payment | null>(null),
    [error, setError] = useState(""),
    [qr, setQr] = useState(""),
    [now, setNow] = useState(0),
    [verified, setVerified] = useState(false);
  useEffect(() => {
    let stopped = false;
    let terminal = false;
    let loading = false;
    const controller = new AbortController();
    const cacheKey = 'byle-checkout-' + token;
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (cached?.currency === 'MMK' && typeof cached.checkout_expires_at === 'string') {
        setPayment(cached);
        setNow(Date.now());
      }
    } catch {}
    const load = async () => {
      if (loading || stopped) return;
      loading = true;
      try {
        const res = await fetch(`/api/checkout/${encodeURIComponent(token)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) {
          if (res.status === 404) {setPayment(null);setVerified(false);sessionStorage.removeItem(cacheKey);}
          throw new Error(data.message || "Checkout is unavailable");
        }
        if (data.currency !== 'MMK') throw new Error('This checkout requires an MMK payment.');
        if (!stopped) {
          setPayment(data);
          setVerified(true);
          try {sessionStorage.setItem(cacheKey, JSON.stringify(data));} catch {}
          setError("");
          setNow(Date.now());
          terminal = !["PENDING", "CREATING"].includes(data.status);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {loading = false;}
    };
    const resume = () => {if (document.visibilityState === 'visible') {setNow(Date.now());void load();}};
    document.addEventListener('visibilitychange', resume);
    void load();
    const timer = setInterval(() => {
      if (!terminal && document.visibilityState === "visible") void load();
    }, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopped = true;
      controller.abort();
      document.removeEventListener("visibilitychange", resume);
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [token]);
  useEffect(() => {
    let active = true;
    setQr("");
    if (payment?.qr && verified)
      QRCode.toDataURL(payment.qr, { width: 300, margin: 4 })
        .then((url) => {
          if (active) setQr(url);
        })
        .catch(() => setError("QR code could not be rendered"));
    return () => {
      active = false;
    };
  }, [payment?.qr, verified]);
  const remaining = payment
    ? Math.max(
        0,
        Math.floor(
          (new Date(payment.checkout_expires_at).getTime() - now) / 1000,
        ),
      )
    : 0;
  const paid = verified && payment?.status === "SUCCESS",
    waiting = payment && ["PENDING", "CREATING"].includes(payment.status),
    expired = Boolean(payment && now && remaining === 0);
  return (
    <main className="checkout-shell">
      <section className="panel checkout-card">
        <div className="checkout-brand">
          b. <span>BYLE GATEWAY</span>
        </div>
        <div className="eyebrow">{payment?.app_name || "SECURE CHECKOUT"}</div>
        {payment?.mode === "sandbox" && (
          <span className="badge yellow">Sandbox · test payment</span>
        )}
        <h1>
          {!verified && payment ? "Checking your saved payment." : paid
            ? "Payment received."
            : payment?.status === "REFUNDED"
              ? "Payment refunded."
              : waiting && expired
                ? "Checkout window ended."
                : waiting
                  ? "Complete your payment."
                  : payment
                    ? "Payment closed."
                    : error?"Checkout unavailable.":"Preparing your checkout."}
        </h1>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {payment && (
          <>
            <p>{payment.description || `Order ${payment.order_id}`}</p>
            <div className="detail-amount">
              {new Intl.NumberFormat("en-US").format(Number(payment.amount))}{" "}
              <small>MMK</small>
            </div>
            {verified && waiting &&
              !expired &&
              (qr ? (
                <>
                  <img className="mmqr-logo" src="/mmqr-logo.png" alt="MyanmarPay MMQR" width={64} height={98} />
                  <img className="mmqr-code"
                    src={qr}
                    alt={`MMQR payment for ${payment.amount} kyat`}
                    width={300}
                    height={300}
                  />
                  <p className="payment-attribution">PAYMENT POWERED BY MYANMYANPAY</p>
                  <p>
                    {payment.mode === "sandbox"
                      ? "Simulate this payment in MyanMyanPay’s dashboard. Do not scan it with a live banking app."
                      : "Scan with your supported banking or wallet app."}
                  </p>
                  <p className="checkout-timer" role="timer" aria-live="off">
                    QR window: {Math.floor(remaining / 60)}:
                    {String(remaining % 60).padStart(2, "0")}
                  </p>
                  <a className="secondary checkout-download" href={qr} download="mmqr-payment.png">Download QR</a>
                </>
              ) : (
                <p>
                  Preparing your payment QR. This page checks automatically.
                </p>
              ))}
            {paid && (
              <p role="status">
                Your payment is confirmed. You can return to the app.
              </p>
            )}
            {verified && waiting && expired && (
              <p>
                This QR is no longer displayed. If you already paid, keep this
                page open while confirmation arrives. Contact the app before
                starting another order.
              </p>
            )}
            {!waiting && !paid && (
              <p>
                Status: {payment.status.toLowerCase()}. Contact the app if you
                need help.
              </p>
            )}
            <div className="setting-row">
              <span>Order</span>
              <strong>{payment.order_id}</strong>
            </div>
            <p className="checkout-footnote">
              Payment confirmation comes from MyanMyanPay. Keep this checkout
              link private.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
