import { colorFilters, fabricFilters, sizeFilters } from "@/data/navigation";
import { PRICE_FILTER_MAX_INR, PRICE_FILTER_MIN_INR } from "@/lib/currency/config";

import type { FabricTech, Product } from "@/lib/types";

export const SORT_OPTIONS = [
  "featured",
  "price-asc",
  "price-desc",
  "newest",
  "rating",
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

export interface ShopFilters {
  category?: string;
  colors: string[];
  sizes: string[];
  fabrics: string[];
  priceMax: number;
  /** Restrict to products with an active discount (`Product.onSale`).
   * Optional (rather than required) so older call sites/tests that
   * construct a `ShopFilters` literal without it keep type-checking —
   * `undefined` behaves exactly like `false` everywhere it's read. */
  onSale?: boolean;
  /** Restrict to products that are currently purchasable
   * (`Product.available !== false`) — the "Availability" facet. Same
   * optional-defaults-to-false treatment as `onSale`. */
  inStock?: boolean;
  sort: SortOption;
}

// The default must be the top of the filter's own range, not some lower
// "typical" cutoff — a lower default silently hides any real product
// priced above it until the shopper manually drags the slider (v1 5.5).
export const defaultShopFilters: ShopFilters = {
  colors: [],
  sizes: [],
  fabrics: [],
  priceMax: PRICE_FILTER_MAX_INR,
  onSale: false,
  inStock: false,
  sort: "featured",
};

export function filterProducts(
  products: Product[],
  filters: ShopFilters,
  /** Maps a category slug to itself plus every descendant slug, so
   * selecting a parent category (e.g. "for-hospitals") also matches
   * products filed under its sub-categories. Omit for an exact-slug
   * match only (the pre-Phase-B3 behaviour, and what the unit tests
   * below exercise). */
  categoryDescendants?: Record<string, string[]>,
): Product[] {
  let result = [...products];

  if (filters.category) {
    const allowed = categoryDescendants?.[filters.category] ?? [filters.category];
    result = result.filter((product) => allowed.includes(product.category));
  }

  if (filters.colors.length > 0) {
    result = result.filter((product) =>
      product.colors.some((color) => filters.colors.includes(color.name)),
    );
  }

  if (filters.sizes.length > 0) {
    result = result.filter((product) =>
      product.sizes.some((size) => filters.sizes.includes(size)),
    );
  }

  if (filters.fabrics.length > 0) {
    result = result.filter((product) =>
      filters.fabrics.some((fabric) =>
        product.fabricTech.includes(fabric as FabricTech),
      ),
    );
  }

  result = result.filter((product) => product.price <= filters.priceMax);

  if (filters.onSale) {
    result = result.filter((product) => product.onSale === true);
  }

  if (filters.inStock) {
    // `available` is optional on the Product type (Shopify-mapped/legacy
    // seed products don't always populate it); treat "unknown" the same
    // way the rest of the app does (see add-to-cart-button.tsx's
    // `product.available ?? true`) — only an explicit `false` excludes it.
    result = result.filter((product) => product.available !== false);
  }

  switch (filters.sort) {
    case "price-asc":
      result.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      result.sort((a, b) => b.price - a.price);
      break;
    case "rating":
      result.sort((a, b) => b.rating - a.rating);
      break;
    case "newest":
      result.sort((a, b) => {
        const aNew = a.badge === "new" ? 1 : 0;
        const bNew = b.badge === "new" ? 1 : 0;
        return bNew - aNew;
      });
      break;
    default:
      result.sort((a, b) => {
        const aScore = (a.badge === "best-seller" ? 2 : 0) + a.rating;
        const bScore = (b.badge === "best-seller" ? 2 : 0) + b.rating;
        return bScore - aScore;
      });
  }

  return result;
}

export function countByCategory(products: Product[]) {
  return products.reduce<Record<string, number>>((acc, product) => {
    acc[product.category] = (acc[product.category] ?? 0) + 1;
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// URL <-> ShopFilters (storefront-ux audit F5 / "Full facet→URL sync")
//
// Every facet below round-trips through the URL using the same
// human-readable, hand-editable convention the pre-existing `?category=`
// and `?q=` params already used: one short key per facet, plain values,
// commas for multi-select (no JSON, no base64 blobs). Defaults are never
// written, so a filtered URL stays as short as possible:
//
//   colors  - comma-separated color names   ?colors=Midnight+Navy,Sage+Green
//   sizes   - comma-separated sizes         ?sizes=M,L
//   fabrics - comma-separated fabric ids    ?fabrics=4-way-stretch
//   price   - single integer (max price)    ?price=6000
//   sale    - boolean flag ("1" or absent)  ?sale=1
//   stock   - boolean flag ("1" or absent)  ?stock=1
//   sort    - existing SortOption union     ?sort=price-asc
//   category, q - unchanged, pre-existing
//
// Parsing is defensive end to end: every value is validated against an
// allow-list (colors/sizes/fabrics/sort) or numeric-clamped (price) or
// strictly boolean (sale/stock) before use, multi-value lists are capped,
// and the whole thing is wrapped in try/catch — a malformed or hostile
// query string can only ever fall back to `defaultShopFilters`, never
// throw. See filters.test.ts for the "junk params" coverage.
// ---------------------------------------------------------------------------

/** Structural subset of `URLSearchParams` (also satisfied by Next's
 * `ReadonlyURLSearchParams` from `useSearchParams()`) — kept minimal and
 * framework-free so this file has zero dependency on `next/navigation`
 * and stays a plain, fast `node:test` target. */
export interface SearchParamsLike {
  get(key: string): string | null;
}

/** Caps applied to every multi-value / free-text param before it's even
 * validated, so a hostile URL (thousands of comma-separated tokens, a
 * multi-megabyte `q`) can't do meaningful work in the parser or blow up
 * the filter-chip UI that renders the result. */
const MAX_LIST_VALUES = 25;
const MAX_PARAM_LENGTH = 300;
const MAX_QUERY_LENGTH = 200;
const MAX_CATEGORY_LENGTH = 100;
const CATEGORY_SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

const VALID_COLOR_NAMES = new Set(colorFilters.map((color) => color.name));
const VALID_SIZES = new Set<string>(sizeFilters);
const VALID_FABRIC_IDS = new Set(fabricFilters.map((fabric) => fabric.id));
const VALID_SORT_OPTIONS = new Set<string>(SORT_OPTIONS);

function isSortOption(value: string): value is SortOption {
  return VALID_SORT_OPTIONS.has(value);
}

function safeGet(params: SearchParamsLike | null | undefined, key: string): string | null {
  if (!params) return null;
  try {
    return params.get(key);
  } catch {
    // A hostile/non-conforming `params` implementation must not be able
    // to crash rendering — treat any throw as "param absent".
    return null;
  }
}

/** Splits a comma-separated value into trimmed, non-empty tokens, capping
 * both the length of the raw string and the number of resulting tokens. */
function splitList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .slice(0, MAX_PARAM_LENGTH)
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, MAX_LIST_VALUES);
}

/** Keeps only tokens present in `allowed`, de-duplicated and order
 * preserved. Anything not in the allow-list (typos, garbage, script/SQLi
 * lookalikes) is silently dropped rather than rejecting the whole param —
 * one bad value in a multi-select shouldn't cost the others. */
function parseAllowedList(raw: string | null, allowed: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of splitList(raw)) {
    if (allowed.has(token) && !seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}

function parsePriceMax(raw: string | null): number {
  if (!raw) return defaultShopFilters.priceMax;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return defaultShopFilters.priceMax;
  // Out-of-range but well-formed numbers are clamped (a shared link with
  // a slightly stale bound still works) rather than discarded outright —
  // only non-numeric/garbage input falls all the way back to the default.
  return Math.round(Math.min(PRICE_FILTER_MAX_INR, Math.max(PRICE_FILTER_MIN_INR, parsed)));
}

/** Strict on purpose: only the literal `"1"` this module ever writes is
 * true. Anything else (`"true"`, `"yes"`, `"0"`, garbage) is a safe,
 * predictable false rather than a guessing game. */
function parseBoolFlag(raw: string | null): boolean {
  return raw === "1";
}

function parseSort(raw: string | null): SortOption {
  return raw !== null && isSortOption(raw) ? raw : defaultShopFilters.sort;
}

function parseCategory(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().slice(0, MAX_CATEGORY_LENGTH);
  return CATEGORY_SLUG_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * Parses every synced facet out of a URL's search params, defensively.
 * Unknown/malformed/hostile values are ignored (never thrown), each
 * falling back to `defaultShopFilters`'s value for that facet — the
 * result always satisfies `filterProducts`'s expected shape and never
 * needs further validation by the caller.
 */
export function parseShopFiltersFromSearchParams(
  params: SearchParamsLike | null | undefined,
  fallback?: { category?: string },
): ShopFilters {
  try {
    // The fallback (server-rendered `initialCategory`, read from this
    // exact same URL one render earlier) goes through the same
    // `parseCategory` sanitizer as the live URL read — it's the same
    // untrusted query string, just handed in via a prop instead of
    // re-parsed, so it gets no less scrutiny.
    const category =
      parseCategory(safeGet(params, "category")) ?? parseCategory(fallback?.category ?? null);
    return {
      category,
      colors: parseAllowedList(safeGet(params, "colors"), VALID_COLOR_NAMES),
      sizes: parseAllowedList(safeGet(params, "sizes"), VALID_SIZES),
      fabrics: parseAllowedList(safeGet(params, "fabrics"), VALID_FABRIC_IDS),
      priceMax: parsePriceMax(safeGet(params, "price")),
      onSale: parseBoolFlag(safeGet(params, "sale")),
      inStock: parseBoolFlag(safeGet(params, "stock")),
      sort: parseSort(safeGet(params, "sort")),
    };
  } catch {
    // Belt-and-braces: whatever went wrong, render the unfiltered page
    // rather than a 500.
    return { ...defaultShopFilters, category: parseCategory(fallback?.category ?? null) };
  }
}

/** Parses the free-text `?q=` search param, capped to a sane length. Kept
 * separate from `ShopFilters` because the component tree already treats
 * "category/facet filters" and "in-results text search" as distinct
 * pieces of state (see ShopPageContent). */
export function parseShopSearchQuery(params: SearchParamsLike | null | undefined): string {
  const raw = safeGet(params, "q");
  if (!raw) return "";
  return raw.slice(0, MAX_QUERY_LENGTH).trim();
}

function setOrDelete(params: URLSearchParams, key: string, value: string | undefined) {
  if (value) params.set(key, value);
  else params.delete(key);
}

/**
 * Applies `filters` + `query` onto a clone of `current`, setting or
 * deleting each synced key as needed and leaving every other param (utm_*
 * campaign tags, etc.) untouched. Values equal to `defaultShopFilters`
 * are omitted so an unfiltered `/shop` never grows a query string, and a
 * shared filtered link stays as short as possible.
 */
export function applyShopFiltersToSearchParams(
  current: SearchParamsLike | string | null | undefined,
  filters: ShopFilters,
  query: string,
): URLSearchParams {
  const base =
    typeof current === "string"
      ? current
      : (current?.toString() ?? "");
  const params = new URLSearchParams(base);

  setOrDelete(params, "category", filters.category || undefined);
  setOrDelete(params, "q", query.trim() || undefined);
  setOrDelete(params, "colors", filters.colors.length > 0 ? filters.colors.join(",") : undefined);
  setOrDelete(params, "sizes", filters.sizes.length > 0 ? filters.sizes.join(",") : undefined);
  setOrDelete(
    params,
    "fabrics",
    filters.fabrics.length > 0 ? filters.fabrics.join(",") : undefined,
  );
  setOrDelete(
    params,
    "price",
    filters.priceMax !== defaultShopFilters.priceMax ? String(filters.priceMax) : undefined,
  );
  setOrDelete(params, "sale", filters.onSale ? "1" : undefined);
  setOrDelete(params, "stock", filters.inStock ? "1" : undefined);
  setOrDelete(
    params,
    "sort",
    filters.sort !== defaultShopFilters.sort ? filters.sort : undefined,
  );

  return params;
}
