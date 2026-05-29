"use client";

import { useCurrency } from "@/context/currency-provider";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/ui/star-rating";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";

interface ProductCardProps {
  product: Product;
  className?: string;
}

export function ProductCard({ product, className }: ProductCardProps) {
  const { formatPrice } = useCurrency();

  return (
    <article
      className={cn(
        "group neon-border-hover product-card-surface relative overflow-hidden rounded-3xl border border-border",
        className,
      )}
    >
      <Link href={`/products/${product.handle}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden bg-lilac/30">
          <Image
            src={product.image}
            alt={product.name}
            fill
            quality={75}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
          />
          <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-ink/50 via-transparent to-transparent p-5 opacity-0 transition duration-300 group-hover:opacity-100">
            <span className="rounded-full bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink shadow-lg">
              View Product
            </span>
          </div>
          {product.badge === "best-seller" && (
            <Badge variant="bestseller" className="absolute left-4 top-4">
              Best Seller
            </Badge>
          )}
          {product.badge === "new" && (
            <Badge variant="new" className="absolute left-4 top-4">
              New
            </Badge>
          )}
          <WishlistButton product={product} className="absolute right-4 top-4" />
        </div>

        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            {product.colors.slice(0, 5).map((color) => (
              <span
                key={color.name}
                className="h-4 w-4 rounded-full border border-black/10 ring-1 ring-white"
                style={{ backgroundColor: color.hex }}
                title={color.name}
              />
            ))}
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold leading-snug text-ink group-hover:text-brand">
              {product.name}
            </h3>
            <p className="text-sm text-muted">{product.colorName}</p>
          </div>
          <div className="flex items-end justify-between gap-2 pt-1">
            <p className="font-display text-xl font-bold text-ink">
              {formatPrice(product.price)}
            </p>
            <StarRating rating={product.rating} reviewCount={product.reviewCount} />
          </div>
        </div>
      </Link>
    </article>
  );
}
