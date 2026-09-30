/** Colourway count remains a lower bound; verified size scope is checked separately. */
export const REQUIRED_IMAGES_PER_COLORWAY = 3;

export interface MediaCoverageProduct {
  slug: string;
  name: string;
  variants: { size: string; color: string; active: boolean }[];
  images: { mediaId: string; color: string | null; size?: string | null; appliesToAllSizes?: boolean }[];
}

export interface MediaCoverageGap {
  slug: string;
  name: string;
  color: string;
  sizes: string[];
  imageCount: number;
  missing: number;
}

export interface SizeImageCoverageGap {
  slug: string;
  color: string;
  size: string;
  verifiedImageCount: number;
  missing: number;
}

export function findProductImageCoverageGaps(products: MediaCoverageProduct[]): MediaCoverageGap[] {
  const gaps: MediaCoverageGap[] = [];
  for (const product of products) {
    const active = product.variants.filter((variant) => variant.active);
    const colors = new Map<string, Set<string>>();
    for (const variant of active) {
      if (!colors.has(variant.color)) colors.set(variant.color, new Set());
      colors.get(variant.color)!.add(variant.size);
    }

    for (const [color, sizes] of colors) {
      // An untagged image cannot safely represent every colour of a
      // multi-colour garment. It is accepted only for a one-colour product.
      const mediaIds = new Set(
        product.images
          .filter((image) => image.color === color || (colors.size === 1 && !image.color))
          .map((image) => image.mediaId),
      );
      if (mediaIds.size >= REQUIRED_IMAGES_PER_COLORWAY) continue;
      gaps.push({
        slug: product.slug,
        name: product.name,
        color,
        sizes: [...sizes].sort(),
        imageCount: mediaIds.size,
        missing: REQUIRED_IMAGES_PER_COLORWAY - mediaIds.size,
      });
    }
  }
  return gaps.sort((a, b) => a.slug.localeCompare(b.slug) || a.color.localeCompare(b.color));
}

/** An image counts only when its colour and size applicability were explicitly verified. */
export function findVerifiedSizeImageCoverageGaps(products: MediaCoverageProduct[]): SizeImageCoverageGap[] {
  const gaps: SizeImageCoverageGap[] = [];
  for (const product of products) {
    const active = product.variants.filter((variant) => variant.active);
    const colors = new Set(active.map((variant) => variant.color));
    for (const variant of active) {
      const mediaIds = new Set(product.images
        .filter((image) =>
          (image.color === variant.color || (colors.size === 1 && !image.color)) &&
          (image.size === variant.size || (!image.size && image.appliesToAllSizes === true)),
        )
        .map((image) => image.mediaId));
      if (mediaIds.size >= REQUIRED_IMAGES_PER_COLORWAY) continue;
      gaps.push({
        slug: product.slug,
        color: variant.color,
        size: variant.size,
        verifiedImageCount: mediaIds.size,
        missing: REQUIRED_IMAGES_PER_COLORWAY - mediaIds.size,
      });
    }
  }
  return gaps.sort((a, b) => a.slug.localeCompare(b.slug) || a.color.localeCompare(b.color) || a.size.localeCompare(b.size));
}
