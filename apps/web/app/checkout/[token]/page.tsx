import type { Metadata } from "next";
import Checkout from "../../../components/checkout";
export const metadata: Metadata = {
  title: "Secure payment · Byle Gateway",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <Checkout token={token} />;
}
