"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { checkoutRemaining, checkoutWindowSeconds } from "../lib/checkout-window";

export default function PaymentQr({ value, expiresAt, orderId }: {
  value: string;
  expiresAt: string;
  orderId: string;
}) {
  const [image, setImage] = useState(""),
    [error, setError] = useState(""),
    [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    let active = true;
    setImage("");
    setError("");
    // Preserve the provider payload and the QR quiet zone; never overlay the logo.
    QRCode.toDataURL(value, { width: 320, margin: 4, color: { dark: "#000000", light: "#ffffff" } })
      .then((data) => { if (active) setImage(data); })
      .catch(() => { if (active) setError("QR code could not be rendered. Please reload the payment."); });
    return () => { active = false; };
  }, [value]);
  const remaining = checkoutRemaining(expiresAt, now);
  if (!now) return <p>Preparing payment QR…</p>;
  if (remaining === 0)
    return <p role="status">The QR display window has ended. Already paid? Wait for confirmation before starting another order.</p>;
  return (
    <div className="payment-qr">
      <img className="mmqr-logo" src="/mmqr-logo.png" width={64} height={98} alt="MyanmarPay MMQR" />
      {error ? <p role="alert">{error}</p> : image ? (
        <>
          <img className="payment-qr-code" src={image} width={320} height={320} alt={`MMQR payment for order ${orderId}`} />
          <p className="payment-attribution">PAYMENT POWERED BY MYANMYANPAY</p>
        </>
      ) : <p>Preparing payment QR…</p>}
      <div className="checkout-timer" aria-label="Payment QR countdown" role="timer">
        <span>Time remaining</span>
        <strong>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</strong>
        <progress max={checkoutWindowSeconds} value={remaining} aria-label="Time remaining in the 15-minute QR window" />
      </div>
      {image && <a className="secondary qr-download" href={image} download={`mmqr-${orderId}.png`}>Download QR</a>}
    </div>
  );
}
