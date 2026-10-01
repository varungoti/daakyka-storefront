"use client";

import { Button, buttonClassNames } from "@/components/ui/button";
import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

/** F-121: a cart line the server no longer considers fully purchasable,
 * from POST /api/checkout/quote (the same side-effect-free revalidation
 * checkout/page already runs — see repriceLines's doc comment in
 * src/lib/orders/create-order.ts). "unavailable" = the product/variant
 * itself (unpublished, deleted); "insufficient" = still active but the
 * cart quantity exceeds current stock. */
interface CartLineProblem {
  variantId: string;
  status: "unavailable" | "insufficient";
  /** Real current stock for an "insufficient" line; always null for
   * "unavailable" (there's no quantity that would fix it). */
  available: number | null;
}

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
  const panelRef = useFocusTrap<HTMLDivElement>(isOpen, closeCart, { lockScroll: true });

  const [problem, setProblem] = useState<CartLineProblem | null>(null);
  const cartItemsKey = cart.lines.map((line) => `${line.variantId}:${line.quantity}`).sort().join("|");

  // F-121: the drawer used to never ask the server whether a line was
  // still purchasable — an unpublished or sold-out item only surfaced a
  // cryptic error at Place Order. Re-checks whenever the drawer is open
  // and the cart contents change, same side-effect-free endpoint the
  // checkout page already uses for its own live price/availability check.
  useEffect(() => {
    // Nothing here reads `problem` while the drawer is closed or the cart
    // is empty (the summary/footer that renders it is itself conditional
    // on `cart.lines.length > 0`), so there's nothing to reset — the next
    // time there's something to check, the fetch below sets it fresh.
    if (!isOpen || cart.lines.length === 0) return;

    const controller = new AbortController();
    fetch("/api/checkout/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) {
          setProblem(null);
          return;
        }
        const data = (await response.json().catch(() => null)) as
          | { variantId?: string; available?: number }
          | null;
        if (!data?.variantId) {
          setProblem(null);
          return;
        }
        setProblem({
          variantId: data.variantId,
          status: response.status === 409 ? "insufficient" : "unavailable",
          available: typeof data.available === "number" ? data.available : null,
        });
      })
      .catch(() => {
        // Network hiccup, or the endpoint is rate-limited — this is a
        // display-only check, so leave whatever was already shown rather
        // than blocking the drawer over it.
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, cartItemsKey]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Close cart overlay"
            className="fixed inset-0 z-[60] bg-overlay-scrim backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeCart}
          />
          <motion.aside
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Shopping cart"
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col bg-surface shadow-2xl outline-none"
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
                  <Link href="/shop" onClick={closeCart} className={buttonClassNames({ className: "mt-6" })}>
                    Shop All Scrubs
                  </Link>
                </div>
              ) : (
                <ul className="space-y-4">
                  {cart.lines.map((line) => {
                    const lineProblem = problem?.variantId === line.variantId ? problem : null;
                    const isUnavailable = lineProblem?.status === "unavailable";
                    // F-121: cap the stepper at whichever ceiling is
                    // tighter — the live stock from the quote check (fresh
                    // as of the last time the drawer opened) or the
                    // add-time stock snapshot (CartLine.maxQuantity, F-108)
                    // for the case the quote hasn't run yet.
                    const effectiveMax =
                      lineProblem?.status === "insufficient" && lineProblem.available !== null
                        ? lineProblem.available
                        : line.maxQuantity;
                    const atCap = typeof effectiveMax === "number" && line.quantity >= effectiveMax;

                    return (
                      <li
                        key={line.id}
                        className={`flex gap-4 rounded-2xl border p-4 ${
                          lineProblem ? "border-red-300 bg-red-50" : "border-border"
                        }`}
                      >
                        <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-lilac/30">
                          <Image
                            src={line.image}
                            alt={line.productTitle}
                            fill
                            unoptimized={line.image.endsWith(".svg")}
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
                          {isUnavailable && (
                            <p className="mt-1 text-xs font-semibold text-red-600">No longer available</p>
                          )}
                          {!isUnavailable && lineProblem && lineProblem.available !== null && (
                            <p className="mt-1 text-xs font-semibold text-amber-600">
                              Only {lineProblem.available} left
                              {lineProblem.available > 0 && (
                                <button
                                  type="button"
                                  className="ml-1 underline underline-offset-2"
                                  onClick={() => updateQuantity(line.id, lineProblem.available!)}
                                  disabled={isLoading}
                                >
                                  Update qty
                                </button>
                              )}
                            </p>
                          )}
                          <div className="mt-auto flex items-center justify-between pt-3">
                            {/* F-240: the steppers measured 22x22 — each button
                                is now a 32px hit area (`grid h-8 w-8`), with
                                the pill's padding and gap tightened so it
                                stays about the same width as before. */}
                            {!isUnavailable && (
                              <div className="flex items-center gap-0.5 rounded-full border border-border px-1 py-0.5">
                                <button
                                  type="button"
                                  aria-label="Decrease quantity"
                                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-lilac/50"
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
                                  className="grid h-8 w-8 place-items-center rounded-full hover:bg-lilac/50 disabled:cursor-not-allowed disabled:opacity-40"
                                  onClick={() =>
                                    updateQuantity(line.id, line.quantity + 1)
                                  }
                                  disabled={isLoading || atCap}
                                >
                                  <Plus size={14} />
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => removeLine(line.id)}
                              className="min-h-8 text-xs font-semibold text-muted hover:text-brand"
                              disabled={isLoading}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
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
                {problem && (
                  <p className="mb-3 text-xs font-medium text-red-600">
                    {problem.status === "unavailable"
                      ? "An item in your cart is no longer available."
                      : "An item in your cart has limited stock."}{" "}
                    Please update it above before checking out.
                  </p>
                )}
                <Button
                  className="w-full"
                  size="lg"
                  onClick={checkout}
                  disabled={isLoading || Boolean(problem)}
                >
                  {mode === "shopify" ? "Checkout" : "Continue to Checkout"}
                </Button>
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
