"use client";

import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/ui/star-rating";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { computePercentOff } from "@/lib/pricing/percent-off";
import { isSizeAvailableForColor, isVariantInStock, resolveVariant } from "@/lib/products/resolve-variant";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

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
 *  - the image is a `<Link>` to the product page (release-hardening audit
 *    F-021: it used to be a `<button>` that opened a full-screen lightbox
 *    instead, so tapping the photo — most of the card on a phone — never
 *    reached the PDP; the lightbox already exists there).
 *  - the wishlist button and colour swatches are siblings of the two
 *    `<Link>`s, not nested inside either.
 *  - the image `<Link>` is `aria-hidden`/`tabIndex={-1}` and the name/
 *    price/"View Product" text sits in its own `<Link>`, so a keyboard or
 *    screen-reader user gets exactly one stop per card, not two identical
 *    ones.
 * No button-inside-anchor or anchor-inside-button remains.
 */
export function ProductCard({ product, className, loadEagerly = false }: ProductCardProps) {
  const { formatPrice } = useCurrency();
  // release-hardening audit F-016: `product.image` and `product.colorName`
  // are now the same colour (see mapDbProductToUi's `defaultColor`) —
  // seeding this from `product.images[0]` instead of `product.image` was
  // the bug that showed a different colour's photo than the label/Quick
  // Add underneath it whenever the gallery's first image wasn't that
  // colour.
  const [displayImage, setDisplayImage] = useState(product.image);
  const [selectedColor, setSelectedColor] = useState(product.colorName);

  const percentOff = computePercentOff(product.price, product.compareAtPrice);
  const isOnSale =
    product.onSale ?? (product.compareAtPrice !== undefined && product.compareAtPrice > product.price);
  const isNew = product.isNew ?? product.badge === "new";
  const isBestSeller = !isNew && product.badge === "best-seller";
  // F-006: `=== false` deliberately — a Shopify/legacy-seed product
  // leaves `available` undefined, and treating that as sold out would
  // wrongly hide Quick Add for products this flag was never computed for.
  const soldOut = product.available === false;

  return (
    <article
      className={cn(
        "product-card-surface group hover:border-brand hover:shadow-sm relative overflow-hidden rounded-3xl border border-border transition-colors",
        className,
      )}
    >
      <div className="relative">
        {/* F-021: a `<Link>`, not a `<button>` that opened a lightbox — see
            the component doc comment. `aria-hidden`/`tabIndex={-1}` keep
            it out of the tab order and the accessibility tree, since the
            name/price `<Link>` below already carries the accessible name
            for "go to this product". */}
        <Link
          href={`/products/${product.handle}`}
          aria-hidden="true"
          tabIndex={-1}
          className="block"
        >
          <div className="relative aspect-[4/5] overflow-hidden bg-lilac/30">
            <Image
              src={displayImage}
              alt={product.name}
              fill
              quality={75}
              unoptimized={displayImage.endsWith(".svg")}
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              sizes="(max-width: 640px) 50vw, (max-width: 1280px) 50vw, 25vw"
              preload={loadEagerly}
              fetchPriority={loadEagerly ? "high" : undefined}
            />
          </div>
        </Link>

        <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-2 sm:left-4 sm:top-4">
          {soldOut && (
            <Badge variant="bestseller" className="pointer-events-auto bg-ink text-white">
              Sold out
            </Badge>
          )}
          {!soldOut && isOnSale && (
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
            // release-hardening audit F-020: this badge (and the
            // /collections/best-sellers page it's driven by) reflects the
            // admin's "Featured" flag, not actual sales — "Best Seller" was
            // a false, specific claim ("chosen by healthcare professionals")
            // for a set that includes kids/school items with no sales data
            // behind it at all.
            <Badge variant="bestseller" className="pointer-events-auto">
              Featured
            </Badge>
          )}
        </div>

        <WishlistButton product={product} className="absolute right-2 top-2 z-10 sm:right-4 sm:top-4" />
      </div>

      {product.colors.length > 1 && (
        <div className="flex items-center gap-1 px-3 pt-3 sm:gap-2 sm:px-5 sm:pt-4">
          {product.colors.slice(0, 5).map((color) => (
            // F-240: the visible swatch stays 16px (`span` below), but the
            // button itself is a 24px hit area — axe's target-size audit
            // flagged the old 16x16 button on 93 nodes on /shop alone.
            <button
              key={color.name}
              type="button"
              onClick={() => {
                // F-016: keep the label and Quick Add's colour in step with
                // whichever swatch is showing, not just the photo — a
                // swatch click used to change only `displayImage`, so the
                // label/Quick Add kept naming the *original* default colour
                // even after the photo changed to a different one.
                setSelectedColor(color.name);
                const match = product.images?.find((img) => img.color === color.name);
                setDisplayImage(match?.url ?? "/placeholder-product.svg");
              }}
              aria-pressed={selectedColor === color.name}
              aria-label={`Preview ${product.name} in ${color.name}`}
              title={color.name}
              className="group/sw grid h-6 w-6 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-full border border-border ring-1 ring-surface-elevated transition group-hover/sw:scale-110"
                style={{ backgroundColor: color.hex }}
              />
            </button>
          ))}
        </div>
      )}

      <Link
        href={`/products/${product.handle}`}
        className={cn(
          "block space-y-2 px-3 pb-2 sm:space-y-3 sm:px-5",
          product.colors.length > 1 ? "pt-2 sm:pt-3" : "pt-3 sm:pt-4",
        )}
      >
        <div>
          <h3 className="font-display text-sm font-semibold leading-snug text-ink group-hover:text-brand sm:text-lg">
            {product.name}
          </h3>
          <p className="text-xs text-muted sm:text-sm">{selectedColor}</p>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <p className="font-display text-base font-bold text-ink sm:text-xl">{formatPrice(product.price)}</p>
            {product.compareAtPrice !== undefined && product.compareAtPrice > product.price && (
              // F-313: labelled "MRP", same as the PDP — an unlabelled
              // strikethrough price next to a "% Off" badge is exactly the
              // pattern counsel flagged as a misleading-reference-price risk.
              <p className="text-xs text-muted sm:text-sm">
                <span aria-hidden="true">MRP </span>
                <s>{formatPrice(product.compareAtPrice)}</s>
              </p>
            )}
          </div>
          {product.reviewCount > 0 && (
            <StarRating rating={product.rating} reviewCount={product.reviewCount} />
          )}
        </div>
        <span className="hidden text-xs font-semibold uppercase tracking-wide text-brand group-hover:underline sm:inline-block">
          View Product
        </span>
      </Link>

      {/* F-006: sold-out products get the badge above, not a Quick Add
          that can only ever fail at checkout — the PDP link still gets
          them to "Notify me when available".
          F-021/F-242: hidden below `sm` — at the ~170px width a 2-column
          mobile card gets, six size chips plus an "Add" button wrap onto
          several lines; the whole photo is now a link to the PDP, which
          has its own full-size add-to-cart. */}
      {!soldOut && (
        <div className="hidden px-5 pb-5 sm:block">
          <QuickAddPanel product={product} selectedColor={selectedColor} />
        </div>
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
function QuickAddPanel({ product, selectedColor }: { product: Product; selectedColor: string }) {
  const { addToCart, isLoading } = useCart();
  // F-016: use the card's currently-shown colour (kept in sync with the
  // swatch and the photo by the parent) rather than always `colors[0]`, so
  // Quick Add can never add a different colour than what's on screen.
  const defaultColor = selectedColor;
  // F-006: default to the first size that's actually in stock for
  // defaultColor, not blindly sizes[0] — otherwise a partially sold-out
  // product pre-selects an unbuyable size and one tap on Quick Add adds
  // it anyway.
  const [selectedSize, setSelectedSize] = useState<string | undefined>(
    () => product.sizes.find((size) => isSizeAvailableForColor(product.variants, size, defaultColor)) ?? product.sizes[0],
  );
  const [justAdded, setJustAdded] = useState(false);

  if (product.sizes.length === 0) return null;

  const size = selectedSize ?? product.sizes[0];
  const resolved = resolveVariant(product.variants, size, defaultColor);
  // F-006: only a variant resolveVariant actually matched can be checked
  // for stock — the synthetic seed-id fallback below (no DB variant
  // exists at all) has no stock field and stays addable, same as today.
  const soldOutSelection = Boolean(resolved) && !isVariantInStock(resolved);

  const handleAdd = async () => {
    if (soldOutSelection) return;
    const activeVariant = resolved ?? {
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
      maxQuantity: typeof activeVariant.stock === "number" ? activeVariant.stock : undefined,
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
        {product.sizes.slice(0, 6).map((s) => {
          const inStock = isSizeAvailableForColor(product.variants, s, defaultColor);
          return (
            <button
              key={s}
              type="button"
              onClick={() => setSelectedSize(s)}
              aria-pressed={size === s}
              className={cn(
                "rounded-md border px-2 py-1 text-xs font-semibold transition",
                !inStock && "text-muted/60 line-through",
                size === s
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border text-muted hover:border-brand",
              )}
            >
              {s}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={handleAdd}
        disabled={isLoading || soldOutSelection}
        className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ShoppingBag size={14} />
        {justAdded ? "Added" : soldOutSelection ? "Sold out" : "Quick Add"}
      </button>
    </div>
  );
}
