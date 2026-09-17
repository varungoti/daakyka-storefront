"use client";

import { MobileFilterDrawer } from "@/components/shop/mobile-filter-drawer";
import { ProductGrid } from "@/components/shop/product-grid";
import { ShopFiltersPanel, type ShopFilterCategory } from "@/components/shop/shop-filters-panel";
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
import type { CategoryTreeNode } from "@/lib/products";
import type { Product } from "@/lib/types";
import type { Testimonial } from "@/lib/types";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";

function flattenSlugs(node: CategoryTreeNode): string[] {
  return [node.slug, ...node.children.flatMap(flattenSlugs)];
}

/** Maps every category slug in the tree (at any depth) to itself plus
 * every one of its descendant slugs, so filtering by a top-level
 * category (e.g. "for-hospitals") also matches products filed under its
 * sub-categories. */
function buildCategoryDescendants(categories: CategoryTreeNode[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const visit = (node: CategoryTreeNode) => {
    map[node.slug] = flattenSlugs(node);
    node.children.forEach(visit);
  };
  categories.forEach(visit);
  return map;
}

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
  categories?: CategoryTreeNode[];
  initialCategory?: string;
  initialQuery?: string;
  fabricTechEnabled?: boolean;
  mixMatchEnabled?: boolean;
}

export function ShopPageContent({
  products,
  testimonials,
  categories = [],
  initialCategory,
  initialQuery,
  fabricTechEnabled = false,
  mixMatchEnabled = false,
}: ShopPageContentProps) {
  const [filters, setFilters] = useState<ShopFilters>({
    ...defaultShopFilters,
    category: initialCategory,
  });
  const [query, setQuery] = useState(initialQuery ?? "");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const categoryDescendants = useMemo(() => buildCategoryDescendants(categories), [categories]);

  const filterCategories = useMemo<ShopFilterCategory[]>(
    () => categories.filter((c) => c.showInMenu).map((c) => ({ slug: c.slug, name: c.name })),
    [categories],
  );

  const categoryCounts = useMemo(() => {
    const leafCounts = countByCategory(products);
    const counts: Record<string, number> = {};
    for (const [slug, descendants] of Object.entries(categoryDescendants)) {
      counts[slug] = descendants.reduce((sum, s) => sum + (leafCounts[s] ?? 0), 0);
    }
    return counts;
  }, [products, categoryDescendants]);

  const filteredProducts = useMemo(() => {
    const result = filterProducts(products, filters, categoryDescendants);
    const q = query.trim().toLowerCase();
    if (!q) return result;
    return result.filter(
      (product) =>
        product.name.toLowerCase().includes(q) ||
        product.colorName.toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q),
    );
  }, [filters, products, query, categoryDescendants]);

  return (
    <>
      <section className="border-b border-border bg-alt-surface py-10 md:py-14">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <nav className="mb-6 text-sm text-muted">
            <Link href="/" className="hover:text-brand">
              Home
            </Link>
            <span className="mx-2">›</span>
            <span className="font-semibold text-ink">Shop</span>
          </nav>
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Browse</p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink md:text-5xl">
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
        <div className="mx-auto grid max-w-[1320px] gap-10 px-4 lg:grid-cols-[280px_1fr] lg:px-8">
          <div className="hidden lg:block">
            <ShopFiltersPanel
              filters={filters}
              onChange={setFilters}
              categories={filterCategories}
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
        categories={filterCategories}
        categoryCounts={categoryCounts}
        totalCount={products.length}
      />

      <ShopMixMatchPromo mixMatchEnabled={mixMatchEnabled} />
      <TrustBar />
      <TestimonialsSection testimonials={testimonials} />
      <ShopFeatureCards fabricTechEnabled={fabricTechEnabled} />
    </>
  );
}
