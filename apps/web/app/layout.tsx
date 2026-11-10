import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
export const metadata: Metadata = {
  title: "Byle Gateway — Your payments, together",
  description: "A private payment workspace powered by MyanMyanPay.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
