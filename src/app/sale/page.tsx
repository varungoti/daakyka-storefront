import { ProductGrid } from "@/components/shop/product-grid";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { getProducts } from "@/lib/products";
import { isSaleEnabled } from "@/lib/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Sale",
  description: "Discounted medical scrubs, uniforms, and apparel from DAAKYKA Apparels while stocks last.",
};

/**
 * Phase C3: the Sale section — admin-togglable via SiteSetting
 * `sale.enabled` (see src/lib/settings). Products are those with a
 * `compareAtPrice` set and greater than the current price
 * (getProducts({ onSale: true }), added in Phase B3).
 */
export default async function SalePage() {
  const enabled = await isSaleEnabled();
  if (!enabled) notFound();

  const products = await getProducts({ onSale: true });

  return (
    <>
      <PageHeroBand innerClassName="max-w-2xl text-center">
        <SectionHeading
          eyebrow="Limited Time"
          title="Sale"
          description="Discounted scrubs, uniforms, and apparel while stocks last."
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection>
        {products.length > 0 ? (
          <ProductGrid products={products} totalCount={products.length} />
        ) : (
          <div className="rounded-3xl border border-dashed border-border bg-surface-muted px-6 py-16 text-center">
            <p className="font-display text-xl font-bold text-ink">No sale items right now</p>
            <p className="mt-2 text-sm text-muted">Check back soon, or browse the full catalog.</p>
          </div>
        )}
      </PageContentSection>
    </>
  );
}
