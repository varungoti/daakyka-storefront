"use client";

import { useWishlist } from "@/context/wishlist-provider";
import { useCurrency } from "@/context/currency-provider";
import { Button } from "@/components/ui/button";
import type { Product } from "@/lib/types";
import { Heart, ShoppingBag, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";

export function WishlistDrawer() {
  const { items, isOpen, closeWishlist, removeFromWishlist } = useWishlist();
  const { formatPrice } = useCurrency();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Close wishlist overlay"
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeWishlist}
          />
          <motion.aside
            role="dialog"
            aria-label="Wishlist"
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col bg-white shadow-2xl"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-5">
              <div className="flex items-center gap-3">
                <Heart className="text-brand" size={22} />
                <div>
                  <p className="font-display text-lg font-bold text-ink">Wishlist</p>
                  <p className="text-sm text-muted">
                    {items.length} saved item{items.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeWishlist}
                className="rounded-full p-2 hover:bg-lilac/50"
                aria-label="Close wishlist"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {items.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <Heart className="mb-4 text-muted" size={40} />
                  <p className="font-display text-lg font-semibold text-ink">
                    Your wishlist is empty
                  </p>
                  <p className="mt-2 text-sm text-muted">
                    Save scrubs you love and come back anytime.
                  </p>
                  <Link href="/shop" onClick={closeWishlist} className="mt-6">
                    <Button>Browse Shop</Button>
                  </Link>
                </div>
              ) : (
                <ul className="space-y-4">
                  {items.map((product) => (
                    <li
                      key={product.id}
                      className="flex gap-4 rounded-2xl border border-border p-4"
                    >
                      <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-xl bg-lilac/30">
                        <Image
                          src={product.image}
                          alt={product.name}
                          fill
                          className="object-cover"
                          sizes="80px"
                        />
                      </div>
                      <div className="flex flex-1 flex-col">
                        <Link
                          href={`/products/${product.handle}`}
                          onClick={closeWishlist}
                          className="font-display font-semibold text-ink hover:text-brand"
                        >
                          {product.name}
                        </Link>
                        <p className="text-sm text-muted">{product.colorName}</p>
                        <p className="mt-1 font-semibold text-ink">
                          {formatPrice(product.price)}
                        </p>
                        <div className="mt-auto flex items-center gap-3 pt-3">
                          <Link href={`/products/${product.handle}`} onClick={closeWishlist}>
                            <Button size="sm">
                              <ShoppingBag size={14} />
                              View
                            </Button>
                          </Link>
                          <button
                            type="button"
                            onClick={() => removeFromWishlist(product.id)}
                            className="text-xs font-semibold text-muted hover:text-brand"
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
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
