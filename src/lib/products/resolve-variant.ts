import type { ProductVariant } from "@/lib/types";

/**
 * Phase C5: size + colour -> variant resolution, pulled out of
 * product-detail.tsx (v1 3.5 plan) so the product card's "Quick add" and
 * the product detail page's size/colour pickers share one implementation
 * and one set of tests, instead of two slightly-different inline copies.
 *
 * Matches on the DB-backed `size`/`color` fields first (Phase B3
 * variants always have these); falls back to the generic
 * `selectedOptions` shape for Shopify- or legacy-seed-backed variants
 * that predate those fields.
 */
export function resolveVariant(
  variants: ProductVariant[] | undefined,
  size: string | undefined,
  color: string | undefined,
): ProductVariant | undefined {
  if (!variants?.length) return undefined;
  if (!size && !color) return variants[0];

  const bySizeAndColor = variants.find((variant) => {
    const sizeMatches = size ? matchesSize(variant, size) : true;
    const colorMatches = color ? matchesColor(variant, color) : true;
    return sizeMatches && colorMatches;
  });
  if (bySizeAndColor) return bySizeAndColor;

  // No exact size+colour match (e.g. that combination doesn't exist as a
  // variant row) — fall back to whichever partial match is available so
  // the UI still shows *something* selected, same as the original inline
  // logic in product-detail.tsx.
  const bySize = size ? variants.find((variant) => matchesSize(variant, size)) : undefined;
  const byColor = color ? variants.find((variant) => matchesColor(variant, color)) : undefined;

  return bySize ?? byColor ?? variants[0];
}

function matchesSize(variant: ProductVariant, size: string): boolean {
  if (variant.size !== undefined) return variant.size === size;
  return variant.selectedOptions.some(
    (option) => option.name.toLowerCase().includes("size") && option.value === size,
  );
}

function matchesColor(variant: ProductVariant, color: string): boolean {
  if (variant.color !== undefined) return variant.color === color;
  return variant.selectedOptions.some(
    (option) => option.name.toLowerCase().includes("color") && option.value === color,
  );
}

/**
 * Whether a variant should be selectable in the UI: DB-backed variants
 * (Phase B3) carry real `stock`, so a size/colour combo with zero stock
 * is out of stock even if `active` is still true. Shopify- or
 * legacy-seed-backed variants have no `stock` field — trust their own
 * `available` flag instead.
 */
export function isVariantInStock(variant: ProductVariant | undefined): boolean {
  if (!variant) return false;
  if (typeof variant.stock === "number") return variant.stock > 0 && variant.available;
  return variant.available;
}

/**
 * For a given colour, whether *any* variant matching (size, colour) is in
 * stock — used to disable/strike a size button per the currently
 * selected colour. Returns `true` (available) when the product has no
 * variant data at all, so legacy/Shopify products without stock tracking
 * never show every size as disabled.
 */
export function isSizeAvailableForColor(
  variants: ProductVariant[] | undefined,
  size: string,
  color: string | undefined,
): boolean {
  if (!variants?.length) return true;
  const matching = variants.filter((variant) => matchesSize(variant, size) && (!color || matchesColor(variant, color)));
  if (matching.length === 0) return true;
  return matching.some((variant) => isVariantInStock(variant));
}
