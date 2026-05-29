"use client";

import { MobileFilterDrawer } from "@/components/shop/mobile-filter-drawer";
import { ProductGrid } from "@/components/shop/product-grid";
import { ShopFiltersPanel } from "@/components/shop/shop-filters-panel";
import {
  ShopFeatureCards,
  ShopMixMatchPromo,
} from "@/components/shop/shop-feature-cards";
import { TrustBar } from "@/components/layout/trust-bar";
import {
  countByCategory,
  defaultShopFilters,
  filterProducts,
  type ShopFilters,
} from "@/lib/shop/filters";
import type { Product } from "@/lib/types";
import type { Testimonial } from "@/lib/types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

const TestimonialsSection = dynamic(
  () =>
    import("@/components/home/testimonials-section").then((mod) => ({
      default: mod.TestimonialsSection,
    })),
  { loading: () => <div className="min-h-[320px]" aria-hidden /> },
);

interface ShopPageContentProps {
  products: Product[];
  testimonials: Testimonial[];
  initialCategory?: string;
  initialQuery?: string;
}

export function ShopPageContent({
  products,
  testimonials,
  initialCategory,
  initialQuery,
}: ShopPageContentProps) {
  const [filters, setFilters] = useState<ShopFilters>({
    ...defaultShopFilters,
    category: initialCategory,
  });
  const [query, setQuery] = useState(initialQuery ?? "");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const categoryCounts = useMemo(() => countByCategory(products), [products]);

  const filteredProducts = useMemo(() => {
    const result = filterProducts(products, filters);
    const q = query.trim().toLowerCase();
    if (!q) return result;
    return result.filter(
      (product) =>
        product.name.toLowerCase().includes(q) ||
        product.colorName.toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q),
    );
  }, [filters, products, query]);

  return (
    <>
      <section className="border-b border-border bg-gradient-to-b from-lavender/40 to-white py-10 md:py-14">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <nav className="mb-6 text-sm text-muted">
            <Link href="/" className="hover:text-brand">
              Home
            </Link>
            <span className="mx-2">›</span>
            <span className="font-semibold text-ink">Shop</span>
          </nav>
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Browse</p>
            <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-ink md:text-5xl">
              Shop All Scrubs
            </h1>
            <p className="mt-3 text-base leading-relaxed text-muted">
              Premium medical apparel with advanced filters for color, size, fabric technology, and
              price — built for long shifts and demanding care environments.
            </p>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-14">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 lg:grid-cols-[280px_1fr] lg:px-8">
          <div className="hidden lg:block">
            <ShopFiltersPanel
              filters={filters}
              onChange={setFilters}
              categoryCounts={categoryCounts}
              totalCount={products.length}
            />
          </div>
          <ProductGrid
            products={filteredProducts}
            totalCount={filteredProducts.length}
            sort={filters.sort}
            onSortChange={(sort) => setFilters({ ...filters, sort })}
            onOpenFilters={() => setMobileFiltersOpen(true)}
            searchQuery={query}
            onSearchQueryChange={setQuery}
          />
        </div>
      </section>

      <MobileFilterDrawer
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        filters={filters}
        onChange={setFilters}
        categoryCounts={categoryCounts}
        totalCount={products.length}
      />

      <ShopMixMatchPromo />
      <TrustBar />
      <TestimonialsSection testimonials={testimonials} />
      <ShopFeatureCards />
    </>
  );
}
