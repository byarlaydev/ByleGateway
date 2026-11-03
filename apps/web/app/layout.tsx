import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Byle Gateway — Your payments, together",
  description: "A private payment workspace powered by MyanMyanPay.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
