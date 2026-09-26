import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";
import { getSetting } from "@/lib/settings";
import Link from "next/link";

export const metadata = policyMetadata(
  "Terms of Service",
  `Terms of service for shopping with ${brand.name}.`,
);

/**
 * release-hardening F-149/F-312: this page used to be three short
 * paragraphs with no seller GSTIN, payment terms, order acceptance/
 * cancellation terms, governing law, eligibility/age clause, or liability
 * limit — the kind of "Terms" page Razorpay's live-mode website review and
 * the Consumer Protection (E-Commerce) Rules 2020 both expect a real seller
 * to have. GSTIN is admin-editable (Settings → Legal) and the line is
 * hidden, not a placeholder, until the owner has actually registered and
 * entered one.
 */
export default async function TermsPage() {
  const [gstin, returnWindowDays] = await Promise.all([
    getSetting("legal.gstin"),
    getSetting("returns.windowDays"),
  ]);

  return (
    <PolicyPage
      title="Terms of Service"
      description={`Terms governing use of the ${brand.name} website and purchase of our products.`}
    >
      <p className="text-xs text-muted">Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long" })}</p>

      <h2 className="mt-2 font-display text-lg font-bold text-ink">Who you&apos;re buying from</h2>
      <p>
        This website is operated by {brand.legalName}, trading as {brand.name}, {brand.location.city},{" "}
        {brand.location.state}, {brand.location.country}
        {gstin ? ` (GSTIN: ${gstin})` : ""}. By using this site or placing an order, you agree to
        these terms.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Products, pricing &amp; images</h2>
      <p>
        Prices are shown in Indian Rupees (INR) and are inclusive of all applicable taxes. Product
        images are representative — colours may vary slightly due to screen settings and fabric
        batches. Institutional and bulk orders are subject to a signed quote and any additional
        terms in that quote. We reserve the right to correct pricing or listing errors, and to
        update these terms; continued use of the site after a change constitutes acceptance of the
        updated terms.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Orders &amp; payment</h2>
      <p>
        Placing an order is an offer to buy, which we may accept or decline (for example if an item
        is out of stock or there&apos;s a pricing error) — we&apos;ll let you know if we can&apos;t
        fulfil an order. Online payments are processed by Razorpay; we never see or store your card,
        UPI or bank details. Some orders may be placed as an order request that we invoice and
        confirm manually.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Cancellations, returns &amp; refunds</h2>
      <p>
        You can cancel an order before it&apos;s dispatched by contacting us. Once delivered, our
        return and exchange window is {returnWindowDays} days — see our{" "}
        <Link href="/returns" className="text-brand hover:underline">
          Returns &amp; Refund Policy
        </Link>{" "}
        for the full terms, exclusions and how refunds are paid.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Shipping</h2>
      <p>
        See our{" "}
        <Link href="/shipping" className="text-brand hover:underline">
          Shipping Policy
        </Link>{" "}
        for delivery fees, timelines and coverage.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Eligibility</h2>
      <p>
        You must be at least 18 years old to place an order on this site, or place it through a
        parent or guardian. Products for children (school and kids&apos; wear) are purchased and
        paid for by an adult on the child&apos;s behalf.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Limitation of liability</h2>
      <p>
        To the extent permitted by law, our liability for any claim arising from your order is
        limited to the amount you paid for that order. We&apos;re not liable for indirect or
        consequential losses.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Governing law</h2>
      <p>
        These terms are governed by the laws of India, and courts in {brand.location.city},{" "}
        {brand.location.state} have exclusive jurisdiction over any dispute arising from them.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Contact &amp; grievances</h2>
      <p>
        For questions about these terms, or a grievance, see our{" "}
        <Link href="/contact" className="text-brand hover:underline">
          Contact page
        </Link>{" "}
        and our{" "}
        <Link href="/privacy-policy" className="text-brand hover:underline">
          Privacy Policy
        </Link>{" "}
        for the named Grievance Officer.
      </p>
    </PolicyPage>
  );
}
