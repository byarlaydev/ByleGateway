"use client";
import { useEffect, useState } from "react";
import PaymentQr from "./payment-qr";
import { checkoutRemaining } from "../lib/checkout-window";
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
  const remaining = payment ? checkoutRemaining(payment.checkout_expires_at, now) : 0;
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
              (payment.qr ? (
                <>
                  <PaymentQr value={payment.qr} expiresAt={payment.checkout_expires_at} orderId={payment.order_id} />
                  <p>
                    {payment.mode === "sandbox"
                      ? "Simulate this payment in MyanMyanPay’s dashboard. Do not scan it with a live banking app."
                      : "Scan with your supported banking or wallet app."}
                  </p>
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
