"use client";

import { useCurrency } from "@/context/currency-provider";
import { fabricFilters } from "@/data/navigation";
import {
  defaultShopFilters,
  normalizeFacetValue,
  type ShopFacets,
  type ShopFilters,
} from "@/lib/shop/filters";
import { cn } from "@/lib/utils";

export interface ShopFilterCategory {
  slug: string;
  name: string;
}

/** `transient: true` marks a change that fires continuously (dragging the
 * price slider) so the caller can `replace` instead of `push` — see
 * ShopPageContent.applyFilters. Omitted/false means a discrete, one-shot
 * toggle (swatch/checkbox/category click). */
export interface ShopFilterChangeMeta {
  transient?: boolean;
}

interface ShopFiltersPanelProps {
  filters: ShopFilters;
  onChange: (filters: ShopFilters, meta?: ShopFilterChangeMeta) => void;
  categories: ShopFilterCategory[];
  categoryCounts: Record<string, number>;
  totalCount: number;
  /** release-hardening audit F-092: fabric ids at least one loaded product
   * actually has. Omitted (server-render/no data yet) shows every option,
   * same as before this fix — only a defined, non-empty product list can
   * ever narrow the list, never widen a false "nothing matches" state. */
  availableFabricIds?: ReadonlySet<string>;
  /** release-hardening F-015/F-094/F-095: the colours, sizes and price range
   * the loaded products really have (`deriveShopFacets`). The Color, Size and
   * Price Range blocks are drawn from this and nothing else — omitted, they
   * are hidden rather than falling back to a fixed list that matches no real
   * product. */
  facets?: ShopFacets;
}

/** A facet with fewer than two choices narrows nothing, so it isn't drawn. */
const MIN_FACET_OPTIONS = 2;

export function ShopFiltersPanel({
  filters,
  onChange,
  categories,
  categoryCounts,
  totalCount,
  availableFabricIds,
  facets,
}: ShopFiltersPanelProps) {
  const { formatPrice } = useCurrency();
  const visibleFabricFilters = availableFabricIds
    ? fabricFilters.filter((fabric) => availableFabricIds.has(fabric.id))
    : fabricFilters;

  const colorOptions = facets?.colors ?? [];
  const sizeOptions = facets?.sizes ?? [];
  const priceFacet = facets?.price ?? null;

  // Colours and sizes match case-insensitively (filterProducts), so a
  // `?colors=navy` link shows the "Navy" swatch as pressed and unticks it.
  const isSelected = (key: "colors" | "sizes" | "fabrics", value: string) =>
    filters[key].some((item) => normalizeFacetValue(item) === normalizeFacetValue(value));

  const toggle = (key: "colors" | "sizes" | "fabrics", value: string) => {
    const current = filters[key];
    onChange({
      ...filters,
      [key]: isSelected(key, value)
        ? current.filter((item) => normalizeFacetValue(item) !== normalizeFacetValue(value))
        : [...current, value],
    });
  };

  // The slider's top stop means "no limit" (the default), so a finite cap is
  // always a lower stop. A `?price=` outside the range is shown at the
  // nearest end; the active-filter chip still names the real value.
  const priceIsCapped = Number.isFinite(filters.priceMax);
  const priceLabel = priceIsCapped ? `Up to ${formatPrice(filters.priceMax)}` : "Any price";

  return (
    <div className="space-y-8">
      <FilterBlock title="Categories">
        <ul className="space-y-2">
          <li>
            <button
              type="button"
              aria-pressed={!filters.category}
              onClick={() => onChange({ ...filters, category: undefined })}
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                !filters.category
                  ? "bg-brand/10 font-semibold text-brand"
                  : "text-ink hover:bg-lilac/40",
              )}
            >
              All Products
              <span className="text-muted">{totalCount}</span>
            </button>
          </li>
          {categories.map((category) => (
            <li key={category.slug}>
              <button
                type="button"
                aria-pressed={filters.category === category.slug}
                onClick={() => onChange({ ...filters, category: category.slug })}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition",
                  filters.category === category.slug
                    ? "bg-brand/10 font-semibold text-brand"
                    : "text-ink hover:bg-lilac/40",
                )}
              >
                {category.name}
                <span className="text-muted">{categoryCounts[category.slug] ?? 0}</span>
              </button>
            </li>
          ))}
        </ul>
      </FilterBlock>

      {colorOptions.length >= MIN_FACET_OPTIONS && (
        <FilterBlock title="Color">
          {/* Name and count sit beside each swatch: with real colours like
              Sky Blue, Ceil Blue and Pale Sky a bare dot is ambiguous. */}
          <div className="flex flex-wrap gap-2">
            {colorOptions.map((color) => {
              const selected = isSelected("colors", color.name);
              return (
                <button
                  key={color.name}
                  type="button"
                  aria-label={`${color.name}, ${color.count} ${color.count === 1 ? "product" : "products"}`}
                  aria-pressed={selected}
                  onClick={() => toggle("colors", color.name)}
                  className={cn(
                    "flex min-h-9 items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-xs font-semibold transition",
                    selected
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-ink hover:border-brand/40",
                  )}
                >
                  <span
                    aria-hidden
                    className="h-5 w-5 shrink-0 rounded-full border border-ink/15"
                    style={{ backgroundColor: color.hex }}
                  />
                  {color.name}
                  <span className="font-normal text-muted">{color.count}</span>
                </button>
              );
            })}
          </div>
        </FilterBlock>
      )}

      {sizeOptions.length >= MIN_FACET_OPTIONS && (
        <FilterBlock title="Size">
          <div className="flex flex-wrap gap-2">
            {sizeOptions.map((size) => {
              const selected = isSelected("sizes", size.value);
              return (
                <button
                  key={size.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggle("sizes", size.value)}
                  className={cn(
                    "min-h-9 min-w-11 rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
                    selected
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border text-ink hover:border-brand/40",
                  )}
                >
                  {size.value}
                </button>
              );
            })}
          </div>
        </FilterBlock>
      )}

      {visibleFabricFilters.length > 0 && (
        <FilterBlock title="Fabric Technology">
          <div className="space-y-2">
            {visibleFabricFilters.map((fabric) => (
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
      )}

      {priceFacet && (
        <FilterBlock title="Price Range">
          <input
            type="range"
            aria-label="Maximum price"
            aria-valuetext={priceLabel}
            min={priceFacet.min}
            max={priceFacet.max}
            step={priceFacet.step}
            value={
              priceIsCapped
                ? Math.min(priceFacet.max, Math.max(priceFacet.min, filters.priceMax))
                : priceFacet.max
            }
            onChange={(event) => {
              const next = Number(event.target.value);
              // Fires on every drag tick — always transient (replace), never
              // push, or dragging the slider would flood browser history.
              // Dragging to the top stop clears the cap instead of pinning
              // it at the dearest product's price, so a dearer product added
              // later is never hidden by the default.
              onChange(
                {
                  ...filters,
                  priceMax: next >= priceFacet.max ? defaultShopFilters.priceMax : next,
                },
                { transient: true },
              );
            }}
            className="w-full accent-brand"
          />
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>{formatPrice(priceFacet.min)}</span>
            <span className="font-semibold text-brand">{priceLabel}</span>
            <span>{formatPrice(priceFacet.max)}+</span>
          </div>
        </FilterBlock>
      )}

      <FilterBlock title="Availability">
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-lilac/30">
            <input
              type="checkbox"
              checked={filters.inStock ?? false}
              onChange={() => onChange({ ...filters, inStock: !filters.inStock })}
              className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
            />
            <span className="text-sm text-ink">In Stock Only</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 hover:bg-lilac/30">
            <input
              type="checkbox"
              checked={filters.onSale ?? false}
              onChange={() => onChange({ ...filters, onSale: !filters.onSale })}
              className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
            />
            <span className="text-sm text-ink">On Sale</span>
          </label>
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
    <div className="hover:border-brand hover:shadow-sm transition-colors rounded-2xl border border-border bg-surface-elevated p-5">
      <p className="mb-4 text-xs font-bold uppercase tracking-[0.15em] text-muted">
        {title}
      </p>
      {children}
    </div>
  );
}
