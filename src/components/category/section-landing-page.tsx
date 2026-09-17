import { ProductGrid } from "@/components/shop/product-grid";
import { Button } from "@/components/ui/button";
import { PageHeroBand, PageContentSection } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import type { CategoryTreeNode } from "@/lib/products";
import type { Product } from "@/lib/types";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/**
 * Phase C3: shared shell for the new top-level section landing pages
 * (`/for-hospitals`, `/school-uniforms`) — a banner, a tile grid of the
 * category's own sub-categories, a product grid (already scoped to the
 * category + its descendants by the caller), and a bulk-order CTA band.
 * `/category/[slug]` uses the full filterable shop UI instead (it needs
 * per-category filters), so it does not use this component.
 */
export function SectionLandingPage({
  eyebrow,
  title,
  description,
  category,
  products,
  bulkNote,
}: {
  eyebrow: string;
  title: string;
  description: string;
  category: CategoryTreeNode;
  products: Product[];
  bulkNote: string;
}) {
  const subCategories = category.children.filter((child) => child.showInMenu);

  return (
    <>
      <PageHeroBand innerClassName="max-w-3xl text-center">
        <SectionHeading eyebrow={eyebrow} title={title} description={description} align="center" titleAs="h1" />
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="#products">
            <Button size="lg">
              Shop {title}
              <ArrowRight size={18} />
            </Button>
          </Link>
          <Link href="/bulk-orders">
            <Button variant="outline" size="lg">
              Bulk Order Enquiry
            </Button>
          </Link>
        </div>
      </PageHeroBand>

      {subCategories.length > 0 && (
        <PageContentSection>
          <SectionHeading eyebrow="Browse" title="Shop by Type" className="mb-8" />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {subCategories.map((sub) => (
              <Link
                key={sub.slug}
                href={`/category/${sub.slug}`}
                className="hover:border-brand hover:shadow-sm transition-colors group overflow-hidden rounded-2xl border border-border"
              >
                <div className="relative aspect-[4/3] bg-lilac/30">
                  {sub.image ? (
                    <Image
                      src={sub.image.url}
                      alt={sub.image.alt ?? sub.name}
                      fill
                      className="object-cover transition duration-300 group-hover:scale-105"
                      sizes="(max-width: 768px) 50vw, 25vw"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-lilac/50 to-lavender/60 text-xs font-semibold uppercase tracking-wide text-brand-violet">
                      {sub.name}
                    </div>
                  )}
                </div>
                <p className="p-4 text-sm font-bold text-ink group-hover:text-brand">{sub.name}</p>
              </Link>
            ))}
          </div>
        </PageContentSection>
      )}

      <PageContentSection variant="alt" innerClassName="scroll-mt-24" className="scroll-mt-24">
        <div id="products">
          <SectionHeading eyebrow="Catalog" title={`${title} Products`} className="mb-8" />
          <ProductGrid products={products} totalCount={products.length} />
        </div>
      </PageContentSection>

      <section className="bg-brand-violet py-12 md:py-16">
        <div className="mx-auto flex max-w-[1320px] flex-col items-center gap-6 px-4 text-center text-white lg:px-8">
          <h2 className="font-display text-2xl font-bold md:text-3xl">Ordering for a team?</h2>
          <p className="max-w-xl text-sm leading-relaxed text-white/85">{bulkNote}</p>
          <Link href="/bulk-orders">
            <Button variant="outline" size="lg" className="border-white text-white hover:bg-white hover:text-brand-violet">
              Request a Bulk Quote
              <ArrowRight size={18} />
            </Button>
          </Link>
        </div>
      </section>
    </>
  );
}
