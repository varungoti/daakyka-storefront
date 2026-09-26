import { BespokeSection } from "@/components/home/bespoke-section";
import { buttonClassNames } from "@/components/ui/button";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Bespoke Collection",
  description:
    "Luxury medical apparel crafted for refinement, performance and prestige.",
};

/**
 * release-hardening audit F-003: this used to list `getProductsByCategory
 * ("bespoke")`, which only ever resolved through a legacy seed-data
 * fallback — fabricated ratings/review counts, PDP links that 404'd, and
 * an "Add to Cart" that checkout could never actually resolve, all live on
 * production. "bespoke" has no real DB category (getProductsByCategory now
 * returns `[]` for it, same as any other unknown slug), so there's no real
 * catalogue to show here yet — an enquiry CTA replaces the product grid
 * until there is one.
 */
export default function BespokePage() {
  return (
    <>
      <BespokeSection />
      <section className="py-16 text-center">
        <div className="mx-auto max-w-2xl px-4 lg:px-8">
          <h2 className="font-display text-2xl font-bold text-ink">
            Building a bespoke order
          </h2>
          <p className="mt-3 text-muted">
            Our bespoke pieces are made to order for hospitals, schools and organisations. Tell us
            what you need and our team will get back to you with fabric, colour and pricing
            options.
          </p>
          <Link href="/bulk-orders" className={buttonClassNames({ size: "lg", className: "mt-6" })}>
            Enquire About Bespoke Orders
          </Link>
        </div>
      </section>
    </>
  );
}
