"use client";

import { useState } from "react";
import { useCart } from "@/context/cart-provider";
import { Button } from "@/components/ui/button";

interface BuyAgainButtonProps {
  variantId: string;
  productHandle: string;
  productTitle: string;
  variantTitle: string | null;
  price: number;
  image: string | null;
}

/**
 * F-300 fix: a delivered order's items had no next step — this re-adds the
 * exact variant this order shipped straight to the cart, reusing the same
 * `addToCart` the PDP's AddToCartButton calls (src/components/cart/
 * add-to-cart-button.tsx) so stock handling and the Shopify-vs-local cart
 * split stay identical between the two. Only rendered by the order page
 * (src/app/account/(dashboard)/orders/[number]/page.tsx) when the product
 * and this exact variant are still active and in stock — an out-of-stock
 * or discontinued variant has nothing sensible to "buy again".
 */
export function BuyAgainButton({ variantId, productHandle, productTitle, variantTitle, price, image }: BuyAgainButtonProps) {
  const { addToCart, isLoading, openCart } = useCart();
  const [justAdded, setJustAdded] = useState(false);

  async function handleClick() {
    await addToCart({
      variantId,
      productHandle,
      productTitle,
      variantTitle: variantTitle ?? "",
      price,
      image: image ?? "",
      quantity: 1,
    });
    setJustAdded(true);
    openCart();
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={isLoading}>
      {justAdded ? "Added!" : "Buy again"}
    </Button>
  );
}
