import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";
import { formatBasePrice } from "@/lib/currency/convert";
import { getSetting } from "@/lib/settings";

export const metadata = policyMetadata(
  "Shipping",
  `Shipping and delivery information for ${brand.name} — ${brand.location.serviceArea}.`,
);

/**
 * release-hardening F-149: this page used to send shoppers to checkout for
 * the fee ("Shipping fees ... are shown at checkout"), while checkout's own
 * sidebar said "Shipping is calculated at the next step" — each page
 * pointed at the other and neither ever showed a number. Reads the same
 * `shipping.*` settings the product page and checkout already use, so it
 * can't drift from what a shopper is actually charged.
 */
export default async function ShippingPage() {
  const [flatRate, freeAbove] = await Promise.all([
    getSetting("shipping.flatRate"),
    getSetting("shipping.freeAbove"),
  ]);

  return (
    <PolicyPage
      title="Shipping & Delivery"
      description={`${brand.legalName} fulfills retail and institutional orders with ${brand.location.serviceArea} coverage from Hyderabad.`}
    >
      <h2 className="mt-2 font-display text-lg font-bold text-ink">Fees</h2>
      <p>
        Flat-rate shipping is {formatBasePrice(flatRate, "INR")} per order, and free on orders above{" "}
        {formatBasePrice(freeAbove, "INR")}.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Processing &amp; delivery time</h2>
      <p>
        Standard retail orders are processed and dispatched within 2–3 business days. Once
        dispatched, delivery typically takes a further 3–7 business days depending on your
        location, via our courier partners. Institutional and bulk orders follow the timeline
        agreed in your quote.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Coverage</h2>
      <p>
        Pan India delivery is available. We currently ship online orders within India only.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Bulk &amp; institutional orders</h2>
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
