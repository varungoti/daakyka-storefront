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

/**
 * F-103: an *exact* (size, color) match, with no partial-match fallback —
 * unlike resolveVariant above, which exists so the UI always has
 * something to show as "selected". Using resolveVariant's fallback to
 * decide what Add to Cart actually adds is the bug: picking Blue then a
 * size that only exists in Red silently added "M / Red" to the cart while
 * the page still showed Blue selected. Callers that need to know whether
 * the shopper's *exact* current selection is purchasable (not just
 * "something is") should use this instead.
 */
export function findExactVariant(
  variants: ProductVariant[] | undefined,
  size: string | undefined,
  color: string | undefined,
): ProductVariant | undefined {
  if (!variants?.length) return undefined;
  return variants.find((variant) => {
    const sizeMatches = size ? matchesSize(variant, size) : true;
    const colorMatches = color ? matchesColor(variant, color) : true;
    return sizeMatches && colorMatches;
  });
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
 * F-103: whether a missing (size, colour) combination (no variant row at
 * all, checked by the caller before calling this) is a *real* gap in the
 * catalogue rather than the legacy "we don't actually track this
 * dimension" case. Both the size and the colour have to be dimensions
 * this product's variants actually use — e.g. if nothing else is size
 * "XL" either, that's "this product doesn't track XL as a dimension",
 * same shape as a Shopify/legacy product with no Color option at all, not
 * "XL exists for other colours but not this one". Only the latter is a
 * real gap.
 */
function isRealGap(variants: ProductVariant[], size: string, color: string | undefined): boolean {
  const sizeKnown = variants.some((variant) => matchesSize(variant, size));
  const colorKnown = !color || variants.some((variant) => matchesColor(variant, color));
  return sizeKnown && colorKnown;
}

/**
 * For a given colour, whether *any* variant matching (size, colour) is in
 * stock — used to strike through a size button (sold out) per the
 * currently selected colour. Returns `true` (available) when the product
 * has no variant data at all, so legacy/Shopify products without stock
 * tracking never show every size as disabled.
 *
 * F-103: a missing (size, colour) row used to also return `true` here
 * unconditionally — "available" for a combination that doesn't exist,
 * which left the size button clickable and let resolveVariant's fallback
 * silently substitute a different colour into the cart than the one shown
 * as selected. Now a *real* gap (see isRealGap above) is reported as
 * unavailable instead; the legacy "this dimension isn't tracked" case
 * still falls back to available, so a product with no Color option never
 * shows every size as disabled. Use `variantExists` below when the caller
 * needs to tell "sold out" (combo exists, no stock — see F-107, still
 * selectable) apart from "doesn't exist" (never selectable).
 */
export function isSizeAvailableForColor(
  variants: ProductVariant[] | undefined,
  size: string,
  color: string | undefined,
): boolean {
  if (!variants?.length) return true;
  const matching = variants.filter((variant) => matchesSize(variant, size) && (!color || matchesColor(variant, color)));
  if (matching.length === 0) return !isRealGap(variants, size, color);
  return matching.some((variant) => isVariantInStock(variant));
}

/**
 * Whether a (size, colour) combination exists as a variant row at all —
 * regardless of stock. Used to decide what should be truly un-clickable
 * (F-103's "this pair was never a real product") versus merely sold out
 * and struck through, but still selectable so "Notify me when available"
 * stays reachable (F-107). Returns `true` for the legacy "this dimension
 * isn't tracked" case too, same as isSizeAvailableForColor.
 */
export function variantExists(
  variants: ProductVariant[] | undefined,
  size: string,
  color: string | undefined,
): boolean {
  if (!variants?.length) return true;
  const matches = variants.some((variant) => matchesSize(variant, size) && (!color || matchesColor(variant, color)));
  if (matches) return true;
  return !isRealGap(variants, size, color);
}
