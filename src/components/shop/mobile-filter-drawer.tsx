"use client";

import { ShopFiltersPanel } from "@/components/shop/shop-filters-panel";
import type { ShopFilters } from "@/lib/shop/filters";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface MobileFilterDrawerProps {
  open: boolean;
  onClose: () => void;
  filters: ShopFilters;
  onChange: (filters: ShopFilters) => void;
  categoryCounts: Record<string, number>;
  totalCount: number;
}

export function MobileFilterDrawer({
  open,
  onClose,
  filters,
  onChange,
  categoryCounts,
  totalCount,
}: MobileFilterDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close filters overlay"
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-label="Shop filters"
            className={cn(
              "fixed inset-y-0 left-0 z-[70] w-full max-w-sm overflow-y-auto bg-background p-6 shadow-2xl lg:hidden",
            )}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 260 }}
          >
            <div className="mb-6 flex items-center justify-between">
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
            <ShopFiltersPanel
              filters={filters}
              onChange={onChange}
              categoryCounts={categoryCounts}
              totalCount={totalCount}
              showHeading={false}
            />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
