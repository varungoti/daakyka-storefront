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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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

interface ShopPageHeading {
  eyebrow?: string;
  title: string;
  description?: string;
  breadcrumbLabel?: string;
}

interface ShopPageContentProps {
  products: Product[];
  testimonials: Testimonial[];
  categories?: CategoryTreeNode[];
  initialCategory?: string;
  initialQuery?: string;
  fabricTechEnabled?: boolean;
  mixMatchEnabled?: boolean;
  /** Overrides the "Shop All Scrubs" hero copy — used by /category/[slug]
   * (Phase C3) to scope this same filterable grid to one category. */
  heading?: ShopPageHeading;
  /** Hides the trust bar / testimonials / feature cards below the grid —
   * used by the narrower /category/[slug] page. Defaults to true (/shop's
   * existing behavior). */
  showExtras?: boolean;
  /** Syncs `category`, `q`, and `sort` to the URL via router.replace as
   * they change (Phase C3 fix for v1 5.5). Defaults to true. */
  syncUrl?: boolean;
}

export function ShopPageContent({
  products,
  testimonials,
  categories = [],
  initialCategory,
  initialQuery,
  fabricTechEnabled = false,
  mixMatchEnabled = false,
  heading,
  showExtras = true,
  syncUrl = true,
}: ShopPageContentProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFiltersState] = useState<ShopFilters>({
    ...defaultShopFilters,
    category: initialCategory,
    sort: (searchParams?.get("sort") as ShopFilters["sort"]) || defaultShopFilters.sort,
  });
  const [query, setQueryState] = useState(initialQuery ?? "");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const syncParams = (next: { category?: string; q?: string; sort?: string }) => {
    if (!syncUrl) return;
    const params = new URLSearchParams(searchParams?.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const setFilters = (next: ShopFilters) => {
    setFiltersState(next);
    syncParams({ category: next.category, sort: next.sort === "featured" ? undefined : next.sort });
  };

  const setQuery = (next: string) => {
    setQueryState(next);
    syncParams({ q: next || undefined });
  };

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

  const pageTitle = heading?.title ?? "Shop All Scrubs";
  const pageEyebrow = heading?.eyebrow ?? "Browse";
  const pageDescription =
    heading?.description ??
    "Premium medical apparel with advanced filters for color, size, fabric technology, and price — built for long shifts and demanding care environments.";
  const breadcrumbLabel = heading?.breadcrumbLabel ?? "Shop";

  return (
    <>
      <section className="border-b border-border bg-alt-surface py-10 md:py-14">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <nav className="mb-6 text-sm text-muted">
            <Link href="/" className="hover:text-brand">
              Home
            </Link>
            <span className="mx-2">›</span>
            <span className="font-semibold text-ink">{breadcrumbLabel}</span>
          </nav>
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{pageEyebrow}</p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink md:text-5xl">
              {pageTitle}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-muted">{pageDescription}</p>
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

      {showExtras && (
        <>
          <ShopMixMatchPromo mixMatchEnabled={mixMatchEnabled} />
          <TrustBar />
          <TestimonialsSection testimonials={testimonials} />
          <ShopFeatureCards fabricTechEnabled={fabricTechEnabled} />
        </>
      )}
    </>
  );
}
