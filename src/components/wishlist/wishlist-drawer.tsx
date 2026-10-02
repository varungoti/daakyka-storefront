"use client";

import { useMotionInitial } from "@/components/layout/lazy-motion-provider";
import { useWishlist } from "@/context/wishlist-provider";
import { useWishlistProducts } from "@/context/wishlist-products";
import { WishlistItemRow } from "@/components/wishlist/wishlist-item-row";
import { buttonClassNames } from "@/components/ui/button";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { Heart, X } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, m } from "framer-motion";

export function WishlistDrawer() {
  const { items, isOpen, closeWishlist } = useWishlist();
  const panelRef = useFocusTrap<HTMLDivElement>(isOpen, closeWishlist, { lockScroll: true });
  const overlayInitial = useMotionInitial({ opacity: 0 });
  const panelInitial = useMotionInitial({ x: "100%" });

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <m.button
            type="button"
            aria-label="Close wishlist overlay"
            className="fixed inset-0 z-[60] bg-overlay-scrim backdrop-blur-sm"
            initial={overlayInitial}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeWishlist}
          />
          <m.aside
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Wishlist"
            className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col bg-surface-elevated shadow-2xl outline-none backdrop-blur-xl"
            initial={panelInitial}
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
              <WishlistDrawerBody />
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * F-113: its own component so the live catalogue is fetched only while the
 * drawer is open (the drawer itself is always mounted, but this renders inside
 * `isOpen &&`), and each opening starts from a fresh download.
 */
function WishlistDrawerBody() {
  const { items, closeWishlist, removeFromWishlist } = useWishlist();
  const { rows, status } = useWishlistProducts();

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-center">
        <Heart className="mb-4 text-muted" size={40} />
        <p className="font-display text-lg font-semibold text-ink">Your wishlist is empty</p>
        <p className="mt-2 text-sm text-muted">Save scrubs you love and come back anytime.</p>
        <Link href="/shop" onClick={closeWishlist} className={buttonClassNames({ className: "mt-6" })}>
          Browse Shop
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-4">
        {rows.map(({ entry, product }) => (
          <WishlistItemRow
            key={entry.id}
            entry={entry}
            product={product}
            loading={status === "loading"}
            onRemove={() => removeFromWishlist(entry.id)}
            onNavigate={closeWishlist}
          />
        ))}
      </ul>
      {status === "error" && (
        <p role="status" className="mt-4 text-sm text-muted">
          Couldn&apos;t load the latest prices and photos. Check your connection and open the wishlist again.
        </p>
      )}
    </>
  );
}
