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
    [now, setNow] = useState(0);
  useEffect(() => {
    let stopped = false;
    let terminal = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/checkout/${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Checkout is unavailable");
        if (!stopped) {
          setPayment(data);
          setError("");
          setNow(Date.now());
          terminal = !["PENDING", "CREATING"].includes(data.status);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!terminal && document.visibilityState === "visible") void load();
    }, 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [token]);
  const remaining = payment
    ? checkoutRemaining(payment.checkout_expires_at, now)
    : 0;
  const paid = payment?.status === "SUCCESS",
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
          {paid
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
            {waiting &&
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
            {waiting && expired && (
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
