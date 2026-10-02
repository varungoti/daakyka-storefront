"use client";

import { useMotionInitial } from "@/components/layout/lazy-motion-provider";
import {
  ShopFiltersPanel,
  type ShopFilterCategory,
  type ShopFilterChangeMeta,
} from "@/components/shop/shop-filters-panel";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { ShopFacets, ShopFilters } from "@/lib/shop/filters";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { AnimatePresence, m } from "framer-motion";

interface MobileFilterDrawerProps {
  open: boolean;
  onClose: () => void;
  filters: ShopFilters;
  onChange: (filters: ShopFilters, meta?: ShopFilterChangeMeta) => void;
  categories: ShopFilterCategory[];
  categoryCounts: Record<string, number>;
  totalCount: number;
  /** release-hardening audit F-092: fabric ids at least one loaded product
   * actually has — passed through to ShopFiltersPanel so the mobile drawer
   * hides the same dead Fabric Technology options the desktop panel does. */
  availableFabricIds?: ReadonlySet<string>;
  /** release-hardening F-015/F-094/F-095: the colours, sizes and price range
   * the loaded products really have (`deriveShopFacets`) — passed through to
   * ShopFiltersPanel, which draws its Color, Size and Price Range blocks from
   * this and nothing else. */
  facets?: ShopFacets;
  /** F-100: live count of products the currently-selected facets match —
   * shown in the footer's primary button so a shopper can see the effect
   * of a pick without closing the drawer first. */
  resultCount: number;
  /** Number of active facets, used to disable "Clear all" when nothing is
   * set and to announce the count change to screen readers. */
  activeCount: number;
  onClearAll: () => void;
}

export function MobileFilterDrawer({
  open,
  onClose,
  filters,
  onChange,
  categories,
  categoryCounts,
  totalCount,
  availableFabricIds,
  facets,
  resultCount,
  activeCount,
  onClearAll,
}: MobileFilterDrawerProps) {
  const panelRef = useFocusTrap<HTMLElement>(open, onClose, { lockScroll: true });
  const overlayInitial = useMotionInitial({ opacity: 0 });
  const panelInitial = useMotionInitial({ x: "-100%" });

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.button
            type="button"
            aria-label="Close filters overlay"
            className="fixed inset-0 z-[60] bg-overlay-scrim backdrop-blur-sm lg:hidden"
            initial={overlayInitial}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <m.aside
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Shop filters"
            className={cn(
              "fixed inset-y-0 left-0 z-[70] flex w-full max-w-sm flex-col bg-background shadow-2xl outline-none lg:hidden",
            )}
            initial={panelInitial}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <p className="font-display text-lg font-bold text-ink">Filters</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-2 hover:bg-lilac/50"
                aria-label="Close filters"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <ShopFiltersPanel
                filters={filters}
                onChange={onChange}
                categories={categories}
                categoryCounts={categoryCounts}
                totalCount={totalCount}
                availableFabricIds={availableFabricIds}
                facets={facets}
              />
            </div>

            {/* F-100: the drawer previously had no result count, Apply or
                Clear-all — filters applied invisibly behind the scrim, and
                the only way to see how many products were left was to
                close the drawer. Filters still apply live (no separate
                "Apply" step, which would break the existing instant
                URL-sync behaviour); this footer's primary button only
                closes the drawer. */}
            <p aria-live="polite" className="sr-only">
              {resultCount} product{resultCount === 1 ? "" : "s"} match the selected filters
            </p>
            <div className="flex gap-3 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={onClearAll}
                disabled={activeCount === 0}
                className="flex-1 rounded-full border border-border px-4 py-3 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-full bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-ink/90"
              >
                Show {resultCount} product{resultCount === 1 ? "" : "s"}
              </button>
            </div>
          </m.aside>
        </>
      )}
    </AnimatePresence>
  );
}
