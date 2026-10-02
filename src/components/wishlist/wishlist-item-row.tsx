"use client";

import { buttonClassNames } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/context/currency-provider";
import { wishlistToggleLabel } from "@/lib/a11y/labels";
import type { WishlistEntry } from "@/lib/wishlist/entries";
import { nameFromHandle, type WishlistProduct } from "@/lib/wishlist/live-products";
import { Heart, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/**
 * F-113/F-142: one saved product, shared by the header wishlist drawer and the
 * account Wishlist tab so both show the same thing: photo, name, colour, the
 * current price (with the MRP when it is on sale), a sold-out tag, a link to
 * choose a size on the product page, and Remove.
 *
 * Everything shown comes from the live catalogue (`product`). While that has not
 * loaded — or could not be read — the row falls back to what the browser itself
 * saved, the handle: a readable name that still links to the product and can be
 * removed.
 *
 * "Choose size" goes to the product page rather than adding to the bag from
 * here: nearly every product comes in several sizes and colours, and a variant
 * has to be picked first.
 */
export function WishlistItemRow({
  entry,
  product,
  loading = false,
  onRemove,
  onNavigate,
}: {
  entry: WishlistEntry;
  product: WishlistProduct | null;
  /** The live data is still on its way: shows a placeholder where the price will be. */
  loading?: boolean;
  onRemove: () => void;
  /** Called when a link is followed (the drawer closes itself). */
  onNavigate?: () => void;
}) {
  const { formatPrice } = useCurrency();
  const handle = product?.handle ?? entry.handle;
  const name = product?.name ?? nameFromHandle(entry.handle);
  const href = `/products/${handle}`;
  const soldOut = product?.available === false;
  const onSale = product?.compareAtPrice !== undefined && product.compareAtPrice > product.price;

  return (
    <li className="flex gap-4 rounded-2xl border border-border p-4">
      <Link
        href={href}
        onClick={onNavigate}
        tabIndex={-1}
        aria-hidden="true"
        className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-lilac/30"
      >
        {product ? (
          <Image
            src={product.image}
            alt=""
            fill
            unoptimized={product.image.endsWith(".svg")}
            className="object-cover"
            sizes="80px"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted">
            <Heart size={22} />
          </span>
        )}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={href}
          onClick={onNavigate}
          className="font-display font-semibold text-ink hover:text-brand"
        >
          {name}
        </Link>
        {product?.colorName && <p className="text-sm text-muted">{product.colorName}</p>}
        {product ? (
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <p className="font-semibold text-ink">{formatPrice(product.price)}</p>
            {onSale && (
              // F-313: labelled "MRP", same as the product page and cards.
              <p className="text-sm text-muted">
                <span aria-hidden="true">MRP </span>
                <s>{formatPrice(product.compareAtPrice as number)}</s>
              </p>
            )}
            {soldOut && <p className="text-xs font-bold uppercase tracking-wide text-sale">Sold out</p>}
          </div>
        ) : loading ? (
          <Skeleton className="mt-2 h-5 w-20" />
        ) : null}
        <div className="mt-auto flex items-center gap-3 pt-3">
          <Link
            href={href}
            onClick={onNavigate}
            className={buttonClassNames({ size: "sm", variant: soldOut ? "outline" : "primary" })}
          >
            {!soldOut && <ShoppingBag size={14} />}
            {soldOut ? "View" : "Choose size"}
          </Link>
          <button
            type="button"
            onClick={onRemove}
            aria-label={wishlistToggleLabel(name, true)}
            className="text-xs font-semibold text-muted hover:text-brand"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
