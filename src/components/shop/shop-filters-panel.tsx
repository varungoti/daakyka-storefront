"use client";

import { useCurrency } from "@/context/currency-provider";
import {
  colorFilters,
  fabricFilters,
  shopCategories,
  sizeFilters,
} from "@/data/navigation";
import {
  PRICE_FILTER_MAX_INR,
  PRICE_FILTER_MIN_INR,
} from "@/lib/currency/config";
import type { ShopFilters } from "@/lib/shop/filters";
import { cn } from "@/lib/utils";

interface ShopFiltersPanelProps {
  filters: ShopFilters;
  onChange: (filters: ShopFilters) => void;
  categoryCounts: Record<string, number>;
  totalCount: number;
  showHeading?: boolean;
}

export function ShopFiltersPanel({
  filters,
  onChange,
  categoryCounts,
  totalCount,
  showHeading = true,
}: ShopFiltersPanelProps) {
  const { formatPrice } = useCurrency();

  const toggle = (key: "colors" | "sizes" | "fabrics", value: string) => {
    const current = filters[key];
    onChange({
      ...filters,
      [key]: current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    });
  };

  return (
    <div className="space-y-8">
      {showHeading && (
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
            Shop All
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">
            Premium Scrubs
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Explore our complete collection of performance-engineered medical
            apparel.
          </p>
        </div>
      )}

      <FilterBlock title="Categories">
        <ul className="space-y-2">
          <li>
            <button
              type="button"
              onClick={() => onChange({ ...filters, category: undefined })}
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                !filters.category
                  ? "bg-brand/10 font-semibold text-brand"
                  : "hover:bg-lilac/40",
              )}
            >
              All Products
              <span className="text-muted">{totalCount}</span>
            </button>
          </li>
          {shopCategories.map((category) => (
            <li key={category.slug}>
              <button
                type="button"
                onClick={() => onChange({ ...filters, category: category.slug })}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                  filters.category === category.slug
                    ? "bg-brand/10 font-semibold text-brand"
                    : "hover:bg-lilac/40",
                )}
              >
                {category.label}
                <span className="text-muted">
                  {categoryCounts[category.slug] ?? category.count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </FilterBlock>

      <FilterBlock title="Color">
        <div className="grid grid-cols-4 gap-3">
          {colorFilters.map((color) => (
            <button
              key={color.name}
              type="button"
              aria-label={color.name}
              onClick={() => toggle("colors", color.name)}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition",
                filters.colors.includes(color.name)
                  ? "border-brand scale-110"
                  : "border-transparent hover:scale-105",
              )}
              style={{ backgroundColor: color.hex }}
            />
          ))}
        </div>
      </FilterBlock>

      <FilterBlock title="Size">
        <div className="grid grid-cols-5 gap-2">
          {sizeFilters.map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => toggle("sizes", size)}
              className={cn(
                "rounded-lg border px-2 py-2 text-xs font-semibold transition",
                filters.sizes.includes(size)
                  ? "border-brand bg-brand/10 text-brand"
                  : "border-border hover:border-brand/40",
              )}
            >
              {size}
            </button>
          ))}
        </div>
      </FilterBlock>

      <FilterBlock title="Fabric Technology">
        <div className="space-y-2">
          {fabricFilters.map((fabric) => (
            <label
              key={fabric.id}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-lilac/30"
            >
              <input
                type="checkbox"
                checked={filters.fabrics.includes(fabric.id)}
                onChange={() => toggle("fabrics", fabric.id)}
                className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
              />
              <span className="text-sm text-ink">{fabric.label}</span>
            </label>
          ))}
        </div>
      </FilterBlock>

      <FilterBlock title="Price Range">
        <input
          type="range"
          min={PRICE_FILTER_MIN_INR}
          max={PRICE_FILTER_MAX_INR}
          value={filters.priceMax}
          onChange={(event) =>
            onChange({ ...filters, priceMax: Number(event.target.value) })
          }
          className="w-full accent-brand"
        />
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>{formatPrice(PRICE_FILTER_MIN_INR)}</span>
          <span className="font-semibold text-brand">{formatPrice(filters.priceMax)}+</span>
          <span>{formatPrice(PRICE_FILTER_MAX_INR)}+</span>
        </div>
      </FilterBlock>
    </div>
  );
}

function FilterBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="mb-4 text-xs font-bold uppercase tracking-[0.15em] text-muted">
        {title}
      </p>
      {children}
    </div>
  );
}
