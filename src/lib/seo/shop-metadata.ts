export const DEFAULT_SHOP_METADATA = {
  title: "Shop Apparel & Uniforms",
  description:
    "Browse DAAKYKA kidswear, hospital scrubs and apparel, institutional linens, and school uniforms by size and category.",
};

const LEGACY_SHOP_SEED = {
  title: "Shop All Scrubs",
  metaDescription: "Browse premium medical scrubs with filters for color, size, fabric technology, and price.",
};

export function resolveShopMetadata(
  override: { title: string; metaDescription: string } | null,
): typeof DEFAULT_SHOP_METADATA {
  // Existing databases retain their create-only seed row. Treat only the
  // untouched legacy pair as obsolete; any admin-authored override wins.
  if (
    override?.title === LEGACY_SHOP_SEED.title &&
    override.metaDescription === LEGACY_SHOP_SEED.metaDescription
  ) {
    return DEFAULT_SHOP_METADATA;
  }
  return {
    title: override?.title?.trim() || DEFAULT_SHOP_METADATA.title,
    description: override?.metaDescription?.trim() || DEFAULT_SHOP_METADATA.description,
  };
}
