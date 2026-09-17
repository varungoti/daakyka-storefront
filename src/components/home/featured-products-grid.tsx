import { ProductGrid } from "@/components/shop/product-grid";
import { SectionHeading } from "@/components/ui/section-heading";
import type { Product } from "@/lib/types";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

/**
 * Phase C3 new home: a plain 4-column product grid section (no toolbar,
 * no client-side sort/search — that's /shop's job), used for both "Best
 * Sellers" and "New Arrivals" on the store home.
 */
export function FeaturedProductsGrid({
  eyebrow,
  title,
  products,
  className,
}: {
  eyebrow: string;
  title: string;
  products: Product[];
  className?: string;
}) {
  if (products.length === 0) return null;

  return (
    <section className={className ?? "bg-alt-surface py-12 md:py-16"}>
      <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <SectionHeading eyebrow={eyebrow} title={title} />
          <Link
            href="/shop"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
          >
            View All Products
            <ArrowRight size={16} />
          </Link>
        </div>
        <ProductGrid products={products} totalCount={products.length} showToolbar={false} />
      </div>
    </section>
  );
}
