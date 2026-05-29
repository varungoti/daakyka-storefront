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
}

export function AddToCartButton({
  product,
  variant,
  quantity = 1,
  size = "md",
  variantStyle = "primary",
  label = "Add to Cart",
  redirectToCheckout = false,
}: AddToCartButtonProps) {
  const { addToCart, checkout, isLoading } = useCart();

  const activeVariant = variant ?? {
    id: product.defaultVariantId ?? `seed-${product.id}`,
    title: product.colorName,
    price: product.price,
    available: product.available ?? true,
    selectedOptions: [],
  };

  const handleClick = async () => {
    await addToCart({
      variantId: activeVariant.id,
      productHandle: product.handle,
      productTitle: product.name,
      variantTitle: activeVariant.title,
      price: activeVariant.price,
      image: activeVariant.image ?? product.image,
      quantity,
    });

    if (redirectToCheckout) {
      checkout();
    }
  };

  return (
    <Button
      variant={variantStyle}
      size={size}
      onClick={handleClick}
      disabled={isLoading || activeVariant.available === false}
    >
      <ShoppingBag size={18} />
      {label}
    </Button>
  );
}
