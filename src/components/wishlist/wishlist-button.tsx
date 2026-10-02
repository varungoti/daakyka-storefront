"use client";

import { useWishlist } from "@/context/wishlist-provider";
import { wishlistToggleLabel } from "@/lib/a11y/labels";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";
import { Heart } from "lucide-react";

interface WishlistButtonProps {
  product: Product;
  className?: string;
}

export function WishlistButton({ product, className }: WishlistButtonProps) {
  const { toggleWishlist, isWishlisted } = useWishlist();
  const active = isWishlisted(product.id);

  return (
    <button
      type="button"
      // F-248: name the product — a listing renders dozens of these, all
      // otherwise announced as the same "Add to wishlist".
      aria-label={wishlistToggleLabel(product.name, active)}
      aria-pressed={active}
      className={cn(
        "rounded-full bg-surface-elevated p-2.5 shadow-sm transition hover:text-brand",
        active ? "text-brand" : "text-muted",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleWishlist(product);
      }}
    >
      <Heart size={18} className={active ? "fill-current" : undefined} />
    </button>
  );
}
