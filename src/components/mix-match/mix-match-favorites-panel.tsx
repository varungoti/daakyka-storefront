"use client";

import { Button } from "@/components/ui/button";
import {
  bottomStyleOptions,
  topStyleOptions,
  type BottomStyle,
  type TopStyle,
} from "@/data/mix-match";
import { useWishlist } from "@/context/wishlist-provider";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Heart, Shirt } from "lucide-react";
import Image from "next/image";

interface MixMatchFavoritesPanelProps {
  onApplyProduct: (product: Product) => void;
  activeTopHandle?: string;
  activeBottomHandle?: string;
}

export function MixMatchFavoritesPanel({
  onApplyProduct,
  activeTopHandle,
  activeBottomHandle,
}: MixMatchFavoritesPanelProps) {
  const { items, openWishlist } = useWishlist();

  if (items.length === 0) {
    return (
      <div className="rounded-[1.75rem] border border-dashed border-brand/25 bg-white/90 p-5 text-center">
        <Heart className="mx-auto text-brand/60" size={28} />
        <p className="mt-3 font-display text-sm font-bold text-ink">Your Favorites</p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Heart products on the shop to apply them instantly in the studio.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={openWishlist}>
          Browse wishlist
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-[1.75rem] border border-border bg-white/95 p-5 shadow-[0_20px_60px_rgba(91,46,255,0.06)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">Your Favorites</p>
          <p className="mt-1 text-sm text-muted">Tap to apply on the avatar</p>
        </div>
        <button
          type="button"
          onClick={openWishlist}
          className="text-xs font-semibold text-brand hover:underline"
        >
          View all
        </button>
      </div>

      <div className="mt-4 max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {items.map((product) => {
          const isActive =
            product.handle === activeTopHandle || product.handle === activeBottomHandle;
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => onApplyProduct(product)}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition",
                isActive
                  ? "border-brand bg-brand/5 shadow-sm"
                  : "border-border hover:border-brand/30 hover:bg-lavender/30",
              )}
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-lilac/40">
                <Image
                  src={product.image}
                  alt={product.name}
                  fill
                  className="object-cover"
                  sizes="56px"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                <p className="text-xs text-muted capitalize">{product.category}</p>
              </div>
              <Shirt size={16} className="shrink-0 text-brand/70" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function applyFavoriteToConfig(
  product: Product,
  current: { topStyle: TopStyle; bottomStyle: BottomStyle },
): { topStyle?: TopStyle; bottomStyle?: BottomStyle } {
  const topMatch = topStyleOptions.find((option) => option.productHandle === product.handle);
  const bottomMatch = bottomStyleOptions.find((option) => option.productHandle === product.handle);

  if (product.category === "tops" && topMatch) {
    return { topStyle: topMatch.id };
  }
  if (product.category === "bottoms" && bottomMatch) {
    return { bottomStyle: bottomMatch.id };
  }
  if (topMatch) return { topStyle: topMatch.id };
  if (bottomMatch) return { bottomStyle: bottomMatch.id };
  return {};
}
