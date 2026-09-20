"use client";

import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import { Badge } from "@/components/ui/badge";
import type { LightboxImage } from "@/components/ui/image-lightbox";
import { StarRating } from "@/components/ui/star-rating";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { computePercentOff } from "@/lib/pricing/percent-off";
import { resolveVariant } from "@/lib/products/resolve-variant";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ShoppingBag } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

// ProductCard renders once per grid item (a dozen-plus times on /shop, /,
// and a PDP's related-products row) — see product-detail.tsx's ImageLightbox
// note. Deferring this the same way keeps its code out of every one of
// those instances' contribution to the shared bundle.
const ImageLightbox = dynamic(() => import("@/components/ui/image-lightbox").then((mod) => mod.ImageLightbox), {
  ssr: false,
});

interface ProductCardProps {
  product: Product;
  className?: string;
  /** Grid callers (see ProductGrid) set this for the first few cards in
   * a listing so their image is fetched eagerly, at high priority, and
   * preloaded via a `<link>` in `<head>` — that first row is frequently
   * the actual LCP element on `/shop` and `/category/[slug]` (confirmed
   * via Lighthouse's largest-contentful-paint-element audit, see
   * docs/PERFORMANCE.md), but every card previously fell back to
   * next/image's default `loading="lazy"`, which defers the fetch until
   * the browser thinks it's near the viewport — actively delaying the
   * LCP paint instead of racing it. Named to avoid any confusion with
   * next/image's own deprecated `priority` prop (see the `preload` prop
   * this sets below). */
  loadEagerly?: boolean;
}

/**
 * Phase C4 rewrite. The old card wrapped everything (image, wishlist
 * button, title, price) in a single `<Link>`, with the wishlist button
 * nested inside it as a real `<button>` (an anchor-containing-button a11y
 * bug, worked around with stopPropagation). Now:
 *  - the image is a `<button>` that opens the full-screen lightbox, and
 *    is NOT inside the product `<Link>`.
 *  - the wishlist button, colour swatches and quick-add are siblings of
 *    the `<button>`/`<Link>`, not nested inside either.
 *  - only the name/price/"View Product" text sits inside the `<Link>`.
 * No button-inside-anchor or anchor-inside-button remains.
 */
export function ProductCard({ product, className, loadEagerly = false }: ProductCardProps) {
  const { formatPrice } = useCurrency();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [displayImage, setDisplayImage] = useState(product.images?.[0]?.url ?? product.image);

  const galleryImages: LightboxImage[] =
    product.images && product.images.length > 0
      ? product.images.map((img) => ({ url: img.url, alt: img.alt ?? product.name }))
      : [{ url: product.image, alt: product.name }];

  const startIndex = Math.max(
    0,
    galleryImages.findIndex((img) => img.url === displayImage),
  );

  const percentOff = computePercentOff(product.price, product.compareAtPrice);
  const isOnSale =
    product.onSale ?? (product.compareAtPrice !== undefined && product.compareAtPrice > product.price);
  const isNew = product.isNew ?? product.badge === "new";
  const isBestSeller = !isNew && product.badge === "best-seller";

  return (
    <article
      className={cn(
        "product-card-surface group hover:border-brand hover:shadow-sm relative overflow-hidden rounded-3xl border border-border transition-colors",
        className,
      )}
    >
      <div className="relative">
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          aria-label={`View full-screen images of ${product.name}`}
          className="block w-full"
        >
          <div className="relative aspect-[4/5] overflow-hidden bg-lilac/30">
            <Image
              src={displayImage}
              alt={product.name}
              fill
              quality={75}
              unoptimized={displayImage.endsWith(".svg")}
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
              preload={loadEagerly}
              fetchPriority={loadEagerly ? "high" : undefined}
            />
            <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-ink/50 via-transparent to-transparent p-5 opacity-0 transition duration-300 group-hover:opacity-100">
              <span className="rounded-md bg-surface px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink shadow-lg">
                View Full Screen
              </span>
            </div>
          </div>
        </button>

        <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-2">
          {isOnSale && (
            <Badge variant="sale" className="pointer-events-auto">
              {percentOff ? `${percentOff}% Off` : "Sale"}
            </Badge>
          )}
          {isNew && (
            <Badge variant="new" className="pointer-events-auto">
              New
            </Badge>
          )}
          {isBestSeller && (
            <Badge variant="bestseller" className="pointer-events-auto">
              Best Seller
            </Badge>
          )}
        </div>

        <WishlistButton product={product} className="absolute right-4 top-4 z-10" />
      </div>

      {product.colors.length > 1 && (
        <div className="flex items-center gap-2 px-5 pt-4">
          {product.colors.slice(0, 5).map((color) => (
            <button
              key={color.name}
              type="button"
              onClick={() => {
                const match = product.images?.find((img) => img.color === color.name);
                if (match) setDisplayImage(match.url);
              }}
              aria-label={`Preview ${product.name} in ${color.name}`}
              title={color.name}
              className="h-4 w-4 rounded-full border border-border ring-1 ring-surface-elevated transition hover:scale-110"
              style={{ backgroundColor: color.hex }}
            />
          ))}
        </div>
      )}

      <Link
        href={`/products/${product.handle}`}
        className={cn("block space-y-3 px-5 pb-2", product.colors.length > 1 ? "pt-3" : "pt-4")}
      >
        <div>
          <h3 className="font-display text-lg font-semibold leading-snug text-ink group-hover:text-brand">
            {product.name}
          </h3>
          <p className="text-sm text-muted">{product.colorName}</p>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <p className="font-display text-xl font-bold text-ink">{formatPrice(product.price)}</p>
            {product.compareAtPrice !== undefined && product.compareAtPrice > product.price && (
              <p className="text-sm text-muted line-through">{formatPrice(product.compareAtPrice)}</p>
            )}
          </div>
          {product.reviewCount > 0 && (
            <StarRating rating={product.rating} reviewCount={product.reviewCount} />
          )}
        </div>
        <span className="inline-block text-xs font-semibold uppercase tracking-wide text-brand group-hover:underline">
          View Product
        </span>
      </Link>

      <div className="px-5 pb-5">
        <QuickAddPanel product={product} />
      </div>

      {lightboxOpen && (
        <ImageLightbox
          images={galleryImages}
          startIndex={startIndex === -1 ? 0 : startIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </article>
  );
}

/**
 * "Quick add": a size picker + add-to-cart action that appears on
 * hover/focus on desktop (`md:` breakpoint) and stays visible on mobile.
 * Deliberately kept as a sibling of the product `<Link>` (see the a11y
 * note above) so its buttons never nest inside an anchor.
 */
function QuickAddPanel({ product }: { product: Product }) {
  const { addToCart, isLoading } = useCart();
  const [selectedSize, setSelectedSize] = useState<string | undefined>(product.sizes[0]);
  const [justAdded, setJustAdded] = useState(false);

  if (product.sizes.length === 0) return null;

  const defaultColor = product.colors[0]?.name ?? product.colorName;

  const handleAdd = async () => {
    const size = selectedSize ?? product.sizes[0];
    const variant = resolveVariant(product.variants, size, defaultColor);
    const activeVariant = variant ?? {
      id: product.defaultVariantId ?? `seed-${product.id}`,
      title: `${size} / ${defaultColor}`,
      price: product.price,
      available: true,
      selectedOptions: [],
    };

    await addToCart({
      variantId: activeVariant.id,
      productHandle: product.handle,
      productTitle: product.name,
      variantTitle: activeVariant.title,
      price: activeVariant.price ?? product.price,
      image: product.image,
      quantity: 1,
    });

    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 1500);
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-t border-border pt-3",
        "md:pointer-events-none md:max-h-0 md:overflow-hidden md:pt-0 md:opacity-0 md:transition-all md:duration-200",
        "md:group-hover:pointer-events-auto md:group-hover:max-h-24 md:group-hover:pt-3 md:group-hover:opacity-100",
        "md:group-focus-within:pointer-events-auto md:group-focus-within:max-h-24 md:group-focus-within:pt-3 md:group-focus-within:opacity-100",
      )}
    >
      <div className="flex flex-wrap gap-1">
        {product.sizes.slice(0, 6).map((size) => (
          <button
            key={size}
            type="button"
            onClick={() => setSelectedSize(size)}
            aria-pressed={(selectedSize ?? product.sizes[0]) === size}
            className={cn(
              "rounded-md border px-2 py-1 text-xs font-semibold transition",
              (selectedSize ?? product.sizes[0]) === size
                ? "border-brand bg-brand/10 text-brand"
                : "border-border text-muted hover:border-brand",
            )}
          >
            {size}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={handleAdd}
        disabled={isLoading}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink/90 disabled:opacity-50"
      >
        <ShoppingBag size={14} />
        {justAdded ? "Added" : "Quick Add"}
      </button>
    </div>
  );
}
