import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";
import { getSetting } from "@/lib/settings";

export const metadata = policyMetadata(
  "Returns, Exchanges & Cancellation Policy",
  `Return, exchange, cancellation and refund policy for ${brand.name} medical apparel.`,
  "/returns",
);

/**
 * release-hardening F-149/F-026: this page used to be three sentences with
 * no cancellation policy, no refund method/timeline, and no return-shipping
 * cost — exactly the "Cancellation & Refund Policy" content Razorpay's
 * live-mode website review and the Consumer Protection (E-Commerce) Rules
 * 2020 both expect. The return window is now read from the same
 * `returns.windowDays` setting the PDP renders (F-026), so the two can't
 * contradict each other again.
 */
export default async function ReturnsPage() {
  const returnWindowDays = await getSetting("returns.windowDays");

  return (
    <PolicyPage
      title="Returns, Exchanges & Cancellation Policy"
      description="We want you to love what you ordered. If something isn't right, we're here to help."
    >
      <h2 className="mt-2 font-display text-lg font-bold text-ink">Cancelling an order</h2>
      <p>
        You can cancel an order any time before it&apos;s dispatched by contacting{" "}
        <a href="/contact?type=support" className="text-brand hover:underline">
          customer support
        </a>{" "}
        with your order number — we&apos;ll cancel it and refund any payment already made in full.
        Once an order has been dispatched, it can no longer be cancelled and falls under the return
        policy below instead.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Returns &amp; exchanges</h2>
      <p>
        Unworn items with original tags may be returned or exchanged within {returnWindowDays} days
        of delivery for retail orders, subject to inspection. To start a return or exchange, contact{" "}
        <a href="/contact?type=support" className="text-brand hover:underline">
          customer support
        </a>{" "}
        with your order number and the reason for the return.
      </p>
      <p>
        Custom embroidery, bespoke (made-to-measure), and institutional bulk orders are made to
        specification and are not eligible for a change-of-mind return or exchange — only for a
        genuine manufacturing defect.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Return shipping</h2>
      <p>
        For a manufacturing defect or an error on our part (wrong item, damaged in transit), we
        cover the cost of return shipping. For a change-of-mind return within the window above, the
        cost of shipping the item back to us is the customer&apos;s responsibility.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Refunds</h2>
      <p>
        Once we receive and inspect a returned item, we&apos;ll refund it to the original payment
        method through Razorpay. Refunds are typically credited within 5–7 business days of approval,
        depending on your bank or card issuer. A cancelled order that was already paid for is
        refunded the same way.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Quality issues</h2>
      <p>
        To report a quality issue or a manufacturing defect, reach out via{" "}
        <a href="/contact?type=support" className="text-brand hover:underline">
          customer support
        </a>{" "}
        with photos of the item and your order number, and we&apos;ll arrange a replacement, repair,
        or refund.
      </p>
    </PolicyPage>
  );
}
