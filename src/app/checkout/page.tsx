import { CheckoutPageContent } from "@/components/checkout/checkout-page-content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Complete your DAAKYKA Apparels order securely.",
  robots: { index: false, follow: false },
};

export default function CheckoutPage() {
  return <CheckoutPageContent />;
}
