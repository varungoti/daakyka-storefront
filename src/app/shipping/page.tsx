import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";

export const metadata = policyMetadata(
  "Shipping",
  `Shipping and delivery information for ${brand.name} — ${brand.location.serviceArea}.`,
);

export default function ShippingPage() {
  return (
    <PolicyPage
      title="Shipping & Delivery"
      description={`${brand.legalName} fulfills retail and institutional orders with ${brand.location.serviceArea} coverage from Hyderabad.`}
    >
      <p>
        Standard retail orders are processed within 2–3 business days. Institutional and bulk
        orders follow agreed timelines in your quote.
      </p>
      <p>
        Pan India delivery is available. Shipping fees and free-shipping thresholds are shown at
        checkout once Shopify checkout is connected.
      </p>
      <p>
        For bulk or hospital orders, contact our team via the{" "}
        <a href="/bulk-orders" className="text-brand hover:underline">
          bulk order form
        </a>{" "}
        or{" "}
        <a href="/contact" className="text-brand hover:underline">
          contact page
        </a>
        .
      </p>
    </PolicyPage>
  );
}
