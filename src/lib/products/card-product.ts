import type { Product, ProductImage, ProductVariant } from "@/lib/types";

/**
 * F-257: what a listing page (/shop, /category/[slug]) hands to the client.
 *
 * Both routes used to serialize every ACTIVE product verbatim into the RSC
 * payload — the full HTML description, SEO/legal fields, every image and
 * every variant with its `selectedOptions` (60 products, 558 variants,
 * ~200 KB) — although a listing card reads a handful of fields. They are
 * statically rendered now (F-018), so the whole catalogue is part of the page
 * and has to stay small as it grows.
 *
 * Still a `Product`, so ProductCard, WishlistButton, filterProducts,
 * matchProducts and the facet derivations take it unchanged. Only what a
 * listing never reads is dropped: descriptions, SEO/legal/care fields,
 * timestamps other than `createdAt` (the "Newest" sort), and from each
 * variant everything but what Quick Add resolves a size/colour to a variant
 * and adds it with. A page that needs the full object (the PDP, the sitemap)
 * keeps reading `getProducts()` directly.
 */

/** React serializes an `undefined` property into the RSC payload as an
 * explicit `"$undefined"` entry, so keys with no value are left out. */
function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/** The card swatch preview (ProductCard) looks an image up by colour — the
 * first one for each colour is the one `find()` returned, so that is all it
 * needs. */
function firstImagePerColor(images: ProductImage[] | undefined): ProductImage[] | undefined {
  if (!images) return undefined;
  const seen = new Set<string>();
  const kept: ProductImage[] = [];
  for (const image of images) {
    if (!image.color || seen.has(image.color)) continue;
    seen.add(image.color);
    kept.push({ url: image.url, color: image.color });
  }
  return kept;
}

/** Quick Add matches a variant by `size`/`color` and reads `id`, `title`,
 * `price`, `available` and `stock`. `selectedOptions` is only the fallback
 * for variants that carry no `size`/`color` (legacy/Shopify shapes), so it is
 * kept for exactly those. */
function toCardVariant(variant: ProductVariant): ProductVariant {
  const hasSizeAndColor = variant.size !== undefined && variant.color !== undefined;
  return withoutUndefined({
    id: variant.id,
    title: variant.title,
    price: variant.price,
    available: variant.available,
    selectedOptions: hasSizeAndColor ? [] : variant.selectedOptions,
    stock: variant.stock,
    size: variant.size,
    color: variant.color,
  });
}

export function toShopCardProduct(product: Product): Product {
  return withoutUndefined({
    id: product.id,
    handle: product.handle,
    name: product.name,
    colorName: product.colorName,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    rating: product.rating,
    reviewCount: product.reviewCount,
    category: product.category,
    categorySlug: product.categorySlug,
    categoryName: product.categoryName,
    section: product.section,
    colors: product.colors,
    sizes: product.sizes,
    fabricTech: product.fabricTech,
    image: product.image,
    images: firstImagePerColor(product.images),
    badge: product.badge,
    variants: product.variants?.map(toCardVariant),
    defaultVariantId: product.defaultVariantId,
    available: product.available,
    onSale: product.onSale,
    isNew: product.isNew,
    tags: product.tags,
    createdAt: product.createdAt,
  });
}
