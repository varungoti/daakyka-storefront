"use client";

import { useMotionInitial } from "@/components/layout/lazy-motion-provider";
import { useCurrency } from "@/context/currency-provider";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { matchProducts } from "@/lib/search/match-products";
import { loadSearchIndex, peekSearchIndex } from "@/lib/search/search-index";
import type { SearchProduct } from "@/lib/products/public-search-product";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, m } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

const RESULTS_ID = "search-results";
const optionId = (productId: string) => `search-option-${productId}`;

// F-083: where a shopper with no matches can go next. Only routes that
// exist and are live today — no Mix & Match / Try-On.
const BROWSE_SHORTCUTS = [
  { href: "/for-hospitals", label: "Hospital range" },
  { href: "/school-uniforms", label: "School uniforms" },
  { href: "/kids-wear", label: "Kids wear" },
  { href: "/sale", label: "Sale" },
] as const;

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // F-013: the index is downloaded once per page session (see
  // src/lib/search/search-index.ts), not on every open. `null` until the first
  // open (or a hover/focus preload) has finished loading it.
  const [fetchedProducts, setFetchedProducts] = useState<SearchProduct[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const products = fetchedProducts ?? peekSearchIndex();
  const loading = products === null && !loadFailed;
  // F-083: index of the result highlighted with the arrow keys, -1 for none.
  // Real DOM focus never leaves the input (combobox pattern) — the
  // highlighted option is exposed through aria-activedescendant instead.
  const [activeIndex, setActiveIndex] = useState(-1);
  const { formatPrice } = useCurrency();
  const close = () => {
    setActiveIndex(-1);
    // A failed download is retried the next time the dialog opens.
    setLoadFailed(false);
    onClose();
  };
  const panelRef = useFocusTrap<HTMLDivElement>(open, close, { lockScroll: true });
  const overlayInitial = useMotionInitial({ opacity: 0 });
  const panelInitial = useMotionInitial({ opacity: 0, y: -12, scale: 0.98 });

  useEffect(() => {
    if (!open || products !== null || loadFailed) return;
    // Fetching on open is the documented data-fetching effect pattern
    // (react.dev/reference/react/useEffect#fetching-data-with-effects); the
    // state is only set from the promise callbacks, and `loading` above is
    // derived, so "Searching..." shows on the very first frame of the open.
    let cancelled = false;
    loadSearchIndex()
      .then((index) => {
        if (!cancelled) setFetchedProducts(index);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, products, loadFailed]);

  // release-hardening audit F-082: was a single whole-string `contains`
  // test — "scrubs", "scrub tops" and "lab coats" all returned nothing —
  // with no ranking, so a category-slug hit could outrank an actual name
  // match. matchProducts (shared with /shop?q=, see shop-page-content.tsx)
  // tokenizes, stems plurals and ranks name hits first.
  const results = useMemo(() => {
    const index = products ?? [];
    if (!query.trim()) return index.slice(0, 6);
    return matchProducts(index, query).slice(0, 8);
  }, [products, query]);

  const showResults = !loading && results.length > 0;
  const activeProduct = showResults && activeIndex >= 0 ? results[activeIndex] : undefined;

  useEffect(() => {
    if (!activeProduct) return;
    document.getElementById(optionId(activeProduct.id))?.scrollIntoView({ block: "nearest" });
  }, [activeProduct]);

  // F-083: Enter used to do nothing (the input wasn't in a form). With a
  // result highlighted it opens that product; otherwise it runs the full
  // search, same destination as the "Search all products" link below.
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (activeProduct) {
      close();
      router.push(`/products/${activeProduct.handle}`);
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) return;
    close();
    router.push(`/shop?q=${encodeURIComponent(trimmed)}`);
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(activeIndex + 1 >= results.length ? 0 : activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(activeIndex <= 0 ? results.length - 1 : activeIndex - 1);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.button
            type="button"
            aria-label="Close search overlay"
            className="fixed inset-0 z-[60] bg-overlay-scrim backdrop-blur-sm"
            initial={overlayInitial}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <m.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Search products"
            className="fixed inset-x-4 top-24 z-[70] mx-auto max-w-2xl rounded-[2rem] border border-border bg-surface-elevated shadow-2xl outline-none backdrop-blur-xl md:inset-x-auto"
            initial={panelInitial}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
          >
            <form
              role="search"
              onSubmit={handleSubmit}
              className="flex items-center gap-3 border-b border-border px-5 py-4"
            >
              <Search className="text-brand" size={20} aria-hidden="true" />
              {/* No `autoFocus`: React applies it during commit, before
                  useFocusTrap's effect records document.activeElement, so
                  the hook saw this input as the "previously focused" element
                  and closing the dialog never returned focus to the header
                  Search button (F-238). The hook focuses the first
                  focusable element — this input — itself. */}
              <input
                type="search"
                role="combobox"
                aria-label="Search products"
                aria-autocomplete="list"
                aria-expanded={showResults}
                aria-controls={RESULTS_ID}
                aria-activedescendant={activeProduct ? optionId(activeProduct.id) : undefined}
                autoComplete="off"
                enterKeyHint="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActiveIndex(-1);
                }}
                onKeyDown={handleInputKeyDown}
                placeholder="Search scrubs, colors, fabrics..."
                className="flex-1 bg-transparent text-base outline-none placeholder:text-muted"
              />
              <button
                type="button"
                onClick={close}
                className="rounded-full p-2 hover:bg-lilac/50"
                aria-label="Close search"
              >
                <X size={18} />
              </button>
            </form>

            <div className="max-h-[420px] overflow-y-auto p-4">
              {loading ? (
                <p role="status" className="px-2 py-8 text-center text-sm text-muted">
                  Searching...
                </p>
              ) : results.length === 0 ? (
                <div role="status" className="px-2 py-6 text-center">
                  <p className="text-sm text-muted">
                    {query.trim() ? <>No products found for &ldquo;{query}&rdquo;</> : "No products to suggest right now."}
                  </p>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                    Or browse
                  </p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {BROWSE_SHORTCUTS.map((shortcut) => (
                      <Link
                        key={shortcut.href}
                        href={shortcut.href}
                        onClick={close}
                        className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
                      >
                        {shortcut.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                // Combobox/listbox pattern (F-083): the <a> itself is the
                // option, out of the Tab order (`tabIndex={-1}`) because the
                // arrow keys move through them while focus stays in the
                // input — the <li> is presentational, since a listbox may
                // only own options.
                <ul id={RESULTS_ID} role="listbox" aria-label="Search results" className="space-y-2">
                  {results.map((product) => (
                    <li key={product.id} role="presentation">
                      <Link
                        id={optionId(product.id)}
                        role="option"
                        aria-selected={activeProduct?.id === product.id}
                        tabIndex={-1}
                        href={`/products/${product.handle}`}
                        onClick={close}
                        className={cn(
                          "flex items-center gap-4 rounded-2xl px-3 py-3 transition hover:bg-lilac/40",
                          activeProduct?.id === product.id && "bg-lilac/40",
                        )}
                      >
                        <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-xl bg-lilac/30">
                          <Image
                            src={product.image}
                            alt={product.name}
                            fill
                            unoptimized={product.image.endsWith(".svg")}
                            className="object-cover"
                            sizes="56px"
                          />
                        </div>
                        <div className="flex-1">
                          <p className="font-display font-semibold text-ink">{product.name}</p>
                          <p className="text-sm text-muted">{product.colorName}</p>
                        </div>
                        <p className="text-sm font-semibold text-brand">
                          {formatPrice(product.price)}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {/* F-082: shown even with zero results (not just `results.length
                  > 0`) — the dialog only shows up to 8 matches, and this is
                  the shopper's one-click way out of "No products found"
                  rather than a dead end.
                  F-083 (review): also shown with an empty query, as "Browse
                  all products". The suggestions list scrolls (max-h + overflow)
                  and its options are `tabIndex={-1}` (arrow-key combobox), so
                  without this link the scroll region had no Tab-focusable
                  descendant — axe `scrollable-region-focusable` (WCAG 2.1.1). */}
              {!loading &&
                (query.trim() ? (
                  <Link
                    href={`/shop?q=${encodeURIComponent(query.trim())}`}
                    onClick={close}
                    className="mt-4 block rounded-2xl bg-lilac/40 px-4 py-3 text-center text-sm font-semibold text-brand hover:bg-lilac/60"
                  >
                    Search all products for &ldquo;{query}&rdquo;
                  </Link>
                ) : (
                  <Link
                    href="/shop"
                    onClick={close}
                    className="mt-4 block rounded-2xl bg-lilac/40 px-4 py-3 text-center text-sm font-semibold text-brand hover:bg-lilac/60"
                  >
                    Browse all products
                  </Link>
                ))}
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
}
