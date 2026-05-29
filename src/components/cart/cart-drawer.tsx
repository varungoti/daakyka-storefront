"use client";

import { Button } from "@/components/ui/button";
import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

export function CartDrawer() {
  const {
    cart,
    isOpen,
    isLoading,
    mode,
    closeCart,
    updateQuantity,
    removeLine,
    checkout,
  } = useCart();
  const { formatPrice } = useCurrency();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Close cart overlay"
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCart}
          />
          <motion.aside
            role="dialog"
            aria-label="Shopping cart"
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col bg-white shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-5">
              <div className="flex items-center gap-3">
                <ShoppingBag className="text-brand" size={22} />
                <div>
                  <p className="font-display text-lg font-bold text-ink">Your Cart</p>
                  <p className="text-sm text-muted">
                    {cart.totalQuantity} item{cart.totalQuantity === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCart}
                className="rounded-full p-2 hover:bg-lilac/50"
                aria-label="Close cart"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {cart.lines.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <ShoppingBag className="mb-4 text-muted" size={40} />
                  <p className="font-display text-lg font-semibold text-ink">
                    Your cart is empty
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    Explore premium scrubs built for long shifts.
                  </p>
                  <Link href="/shop" onClick={closeCart} className="mt-6">
                    <Button>Shop All Scrubs</Button>
                  </Link>
                </div>
              ) : (
                <ul className="space-y-4">
                  {cart.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex gap-4 rounded-2xl border border-border p-4"
                    >
                      <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-lilac/30">
                        <Image
                          src={line.image}
                          alt={line.productTitle}
                          fill
                          className="object-cover"
                          sizes="80px"
                        />
                      </div>
                      <div className="flex flex-1 flex-col">
                        <Link
                          href={`/products/${line.productHandle}`}
                          onClick={closeCart}
                          className="font-display font-semibold text-ink hover:text-brand"
                        >
                          {line.productTitle}
                        </Link>
                        <p className="text-sm text-muted">{line.variantTitle}</p>
                        <p className="mt-1 font-semibold text-ink">
                          {formatPrice(line.price)}
                        </p>
                        <div className="mt-auto flex items-center justify-between pt-3">
                          <div className="flex items-center gap-2 rounded-full border border-border px-2 py-1">
                            <button
                              type="button"
                              aria-label="Decrease quantity"
                              className="rounded-full p-1 hover:bg-lilac/50"
                              onClick={() =>
                                line.quantity > 1
                                  ? updateQuantity(line.id, line.quantity - 1)
                                  : removeLine(line.id)
                              }
                              disabled={isLoading}
                            >
                              <Minus size={14} />
                            </button>
                            <span className="min-w-6 text-center text-sm font-semibold">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              aria-label="Increase quantity"
                              className="rounded-full p-1 hover:bg-lilac/50"
                              onClick={() =>
                                updateQuantity(line.id, line.quantity + 1)
                              }
                              disabled={isLoading}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line.id)}
                            className="text-xs font-semibold text-muted hover:text-brand"
                            disabled={isLoading}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {cart.lines.length > 0 && (
              <div className="border-t border-border px-6 py-5">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm text-muted">Subtotal</span>
                  <span className="font-display text-xl font-bold text-ink">
                    {formatPrice(cart.subtotal)}
                  </span>
                </div>
                <Button
                  className="w-full"
                  size="lg"
                  onClick={checkout}
                  disabled={isLoading}
                >
                  {mode === "shopify" ? "Checkout" : "Continue to Checkout"}
                </Button>
                {mode === "local" && (
                  <p className="mt-3 text-center text-xs text-muted">
                    Demo mode — connect Shopify for live checkout.
                  </p>
                )}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
