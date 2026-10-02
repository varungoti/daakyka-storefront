import type { Product } from "@/lib/types";

/**
 * F-114: the products under "You May Also Like". It used to take only the
 * product's own leaf category, so a category with a single product (draw
 * sheets, pillow covers, bedsheets) had nothing to show and the PDP ended
 * without a recommendation. Fills up to `limit` from, in order: the same
 * category, the same section (hospital, school, kids...), then `fallback` (the
 * store's best sellers). A product is never recommended to itself and never
 * twice, and the page keeps the catalogue's own order within each tier.
 */
export function pickRelatedProducts<T extends Pick<Product, "id" | "category" | "section">>(
  product: T,
  catalogue: readonly T[],
  limit = 4,
  fallback: readonly T[] = [],
): T[] {
  const picked: T[] = [];
  const taken = new Set<string>([product.id]);

  const take = (candidates: readonly T[]) => {
    for (const candidate of candidates) {
      if (picked.length >= limit) return;
      if (taken.has(candidate.id)) continue;
      taken.add(candidate.id);
      picked.push(candidate);
    }
  };

  take(catalogue.filter((item) => item.category === product.category));
  if (product.section) take(catalogue.filter((item) => item.section === product.section));
  take(fallback);

  return picked;
}
