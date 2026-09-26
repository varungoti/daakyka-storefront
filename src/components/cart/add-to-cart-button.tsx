"use client";

import { Button } from "@/components/ui/button";
import { useCart } from "@/context/cart-provider";
import type { Product, ProductVariant } from "@/lib/types";
import { ShoppingBag } from "lucide-react";

interface AddToCartButtonProps {
  product: Product;
  variant?: ProductVariant;
  quantity?: number;
  size?: "sm" | "md" | "lg";
  variantStyle?: "primary" | "outline";
  label?: string;
  redirectToCheckout?: boolean;
  /** F-103/F-107: force the disabled, "Sold out" state regardless of
   * `variant`/the synthetic fallback below. Passing `variant={undefined}`
   * alone does *not* disable the button — it falls back to a synthetic
   * variant that reads as available (see `activeVariant` below), which is
   * exactly how F-103's missing-combo bug and F-028's zero-variant bug
   * both let a shopper add something unbuyable. Set this whenever the
   * caller knows the shopper's current, exact selection isn't purchasable
   * — a combo that doesn't exist as a row, not merely a resolved
   * fallback variant. */
  unavailable?: boolean;
}

export function AddToCartButton({
  product,
  variant,
  quantity = 1,
  size = "md",
  variantStyle = "primary",
  label = "Add to Cart",
  redirectToCheckout = false,
  unavailable = false,
}: AddToCartButtonProps) {
  const { addToCart, checkout, isLoading } = useCart();

  const activeVariant = variant ?? {
    id: product.defaultVariantId ?? `seed-${product.id}`,
    title: product.colorName,
    price: product.price,
    available: product.available ?? true,
    selectedOptions: [],
  };
  const isUnavailable = unavailable || activeVariant.available === false;

  const handleClick = async () => {
    if (isUnavailable) return;
    const result = await addToCart({
      variantId: activeVariant.id,
      productHandle: product.handle,
      productTitle: product.name,
      variantTitle: activeVariant.title,
      price: activeVariant.price,
      image: activeVariant.image ?? product.image,
      quantity,
      // F-108: the cart's own ceiling on this line — never trusts the
      // caller's `quantity` alone. Only set for DB-tracked variants
      // (`stock` is undefined for Shopify/legacy-seed ones, which don't
      // track it).
      maxQuantity: typeof activeVariant.stock === "number" ? activeVariant.stock : undefined,
    });

    if (redirectToCheckout) {
      // Redirect straight to the cart this add just produced, rather than
      // the (possibly empty) checkoutUrl from before the add resolved.
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        checkout();
      }
    }
  };

  return (
    <Button
      variant={variantStyle}
      size={size}
      onClick={handleClick}
      disabled={isLoading || isUnavailable}
    >
      <ShoppingBag size={18} />
      {isUnavailable ? "Sold out" : label}
    </Button>
  );
}
