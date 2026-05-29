"use client";

import { Button } from "@/components/ui/button";
import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import { isShopifyConfigured } from "@/lib/shopify/config";
import { ArrowRight, Lock, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function CheckoutPageContent() {
  const { cart, checkout, mode } = useCart();
  const { formatPrice } = useCurrency();
  const shopifyReady = isShopifyConfigured();

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <ShoppingBag className="mx-auto mb-4 text-muted" size={48} />
        <h1 className="font-display text-2xl font-bold text-ink">Your cart is empty</h1>
        <Link href="/shop" className="mt-6 inline-block">
          <Button>Continue Shopping</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 lg:px-8">
      <h1 className="font-display text-3xl font-bold text-ink">Checkout</h1>
      <p className="mt-2 text-muted">
        {shopifyReady && mode === "shopify"
          ? "Secure checkout powered by Shopify."
          : "Complete your order — our team will assist while Shopify checkout is being connected."}
      </p>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-4">
          <h2 className="font-display text-lg font-bold text-ink">Order Summary</h2>
          {cart.lines.map((line) => (
            <article
              key={line.id}
              className="flex gap-4 rounded-2xl border border-border bg-white p-4"
            >
              <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-lilac/30">
                <Image src={line.image} alt={line.productTitle} fill className="object-cover" sizes="64px" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-ink">{line.productTitle}</p>
                <p className="text-sm text-muted">{line.variantTitle} × {line.quantity}</p>
                <p className="mt-1 font-semibold">{formatPrice(line.price * line.quantity)}</p>
              </div>
            </article>
          ))}
        </section>

        <aside className="h-fit rounded-3xl border border-border bg-lavender/30 p-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Subtotal</span>
            <span className="font-display text-2xl font-bold text-ink">{formatPrice(cart.subtotal)}</span>
          </div>
          <p className="mt-2 text-xs text-muted">Shipping and taxes calculated at next step.</p>

          <Button className="mt-6 w-full" size="lg" onClick={checkout}>
            {shopifyReady && mode === "shopify" ? (
              <>
                <Lock size={18} />
                Pay Securely with Shopify
              </>
            ) : (
              <>
                Request Order Assistance
                <ArrowRight size={18} />
              </>
            )}
          </Button>

          {!shopifyReady && (
            <p className="mt-4 text-center text-xs text-muted">
              Or email{" "}
              <Link href="/contact?intent=checkout" className="text-brand hover:underline">
                contact us
              </Link>{" "}
              with your cart details.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
