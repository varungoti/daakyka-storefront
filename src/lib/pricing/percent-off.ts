/**
 * Phase C4/C5: the "X% off" calculation shared by the product card badge
 * and the product detail price block. Pulled out as a pure function so
 * both call sites agree on the rounding rule and so it's unit-testable
 * without rendering anything.
 */
export function computePercentOff(
  price: number,
  compareAtPrice: number | undefined | null,
): number | null {
  if (compareAtPrice === undefined || compareAtPrice === null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(compareAtPrice)) return null;
  if (compareAtPrice <= price || compareAtPrice <= 0) return null;

  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}
