import { fabricFilters } from "@/data/navigation";
import { compareSizes, findPresetColorHex } from "@/lib/catalog/size-presets";

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
  /** Highest price (INR) a product may have. `Number.POSITIVE_INFINITY` —
   * the default — means "no upper limit", so a product priced above
   * whatever the slider's top happens to be is never hidden. */
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

// The default price cap is "no limit" rather than any number: a finite
// default silently hides every product priced above it until the shopper
// drags the slider (v1 5.5), and a bound that doesn't come from the
// catalogue never fits it (F-094: the slider ran INR 2,499-10,999 over a
// catalogue priced INR 149-2,999). The slider's own range is derived from
// the live products — see `derivePriceFacet`.
export const defaultShopFilters: ShopFilters = {
  colors: [],
  sizes: [],
  fabrics: [],
  priceMax: Number.POSITIVE_INFINITY,
  onSale: false,
  inStock: false,
  sort: "featured",
};

/** The form every colour/size value is compared in: trimmed and
 * lower-cased, so "Navy", "navy " and "NAVY" are one facet value. */
export function normalizeFacetValue(value: string): string {
  return value.trim().toLowerCase();
}

/** Whether `product` is filed under `category` or, when `descendants` is
 * given, any of its sub-categories. Shared by `filterProducts` and the facet
 * derivation so both always agree on what "in this category" means. */
function inCategory(
  product: Product,
  category: string,
  descendants?: Record<string, string[]>,
): boolean {
  const allowed = descendants?.[category] ?? [category];
  return allowed.includes(product.category);
}

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
    const category = filters.category;
    result = result.filter((product) => inCategory(product, category, categoryDescendants));
  }

  // Colours and sizes compare case-insensitively (see `normalizeFacetValue`)
  // so a hand-typed `?colors=navy`, or a variant saved as "navy", still
  // matches the "Navy" the facet offers.
  if (filters.colors.length > 0) {
    const wanted = new Set(filters.colors.map(normalizeFacetValue));
    result = result.filter((product) =>
      product.colors.some((color) => wanted.has(normalizeFacetValue(color.name))),
    );
  }

  if (filters.sizes.length > 0) {
    const wanted = new Set(filters.sizes.map(normalizeFacetValue));
    result = result.filter((product) =>
      product.sizes.some((size) => wanted.has(normalizeFacetValue(size))),
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
      // release-hardening audit F-096: this used to sort purely on the
      // admin-set `isNew` badge, which isn't a date at all — every "New"
      // product tied for 1st (in whatever order they happened to be in),
      // and a just-published product with the flag left unchecked ranked
      // behind all of them. `createdAt` is the row's real creation date;
      // `isNew` only breaks a tie between two products created at the
      // exact same instant (practically: the tie almost never happens).
      result.sort((a, b) => {
        const createdAtA = a.createdAt ? Date.parse(a.createdAt) : 0;
        const createdAtB = b.createdAt ? Date.parse(b.createdAt) : 0;
        return createdAtB - createdAtA || (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0);
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
// Facets derived from the live catalogue (release-hardening F-015/F-094/F-095)
//
// The colour swatches, size chips and price-slider range used to be fixed
// lists written for the seed catalogue ("Midnight Navy", XXS-5XL, INR
// 2,499-10,999). None of them matched what the DB actually holds, so every
// swatch returned "0 Products", four of the ten size chips matched nothing
// while kids/school/linen sizes had no chip at all, and the slider could
// not narrow an INR 149-2,999 catalogue. The options are now computed from
// the products the page was rendered with, so a facet only ever offers a
// value at least one product really has.
// ---------------------------------------------------------------------------

/** Longest colour/size value a facet or URL token may have. */
const FACET_TOKEN_MAX_LENGTH = 40;

/** Letters, digits, spaces and a few separators real colour/size names use
 * ("Ceil Blue", "10-11Y", "Made to Measure", "Black/White", "Blue (Light)").
 * Deliberately not an allow-list of known values — that is what made every
 * real colour/size unreachable — only a shape check that keeps markup, SQL
 * punctuation and the `,` list separator out of the URL round-trip. */
const FACET_TOKEN_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._&'/+()-]*$/u;

/** Whether `value` is a colour/size token the URL can carry and
 * `parseShopFiltersFromSearchParams` will accept. Facet options are filtered
 * through this so the shop never offers a choice that would not survive a
 * reload or a shared link. */
export function isFacetToken(value: string): boolean {
  return value.length > 0 && value.length <= FACET_TOKEN_MAX_LENGTH && FACET_TOKEN_PATTERN.test(value);
}

export interface ColorFacetOption {
  /** Display name, also the value written to `ShopFilters.colors`. */
  name: string;
  /** A real swatch colour, or the neutral placeholder when none is known. */
  hex: string;
  /** Number of products with at least one variant in this colour. */
  count: number;
}

export interface SizeFacetOption {
  /** Display name, also the value written to `ShopFilters.sizes`. */
  value: string;
  /** Number of products with at least one variant in this size. */
  count: number;
}

/** Bounds for the max-price slider, all in INR. The slider's top position is
 * "no limit" (`defaultShopFilters.priceMax`), not a cap at `max`. */
export interface PriceFacet {
  min: number;
  max: number;
  step: number;
}

export interface ShopFacets {
  colors: ColorFacetOption[];
  sizes: SizeFacetOption[];
  /** `null` when the products don't span a price range worth filtering. */
  price: PriceFacet | null;
}

/** The grey `mapDbProductToUi` gives a colour whose variants carry no
 * `colorHex`. It is a placeholder, not a colour anyone chose. */
const PLACEHOLDER_COLOR_HEX = "#CBD5E1";
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** The key with the highest tally; the first-seen one wins a tie, so the
 * result never depends on anything but product order. */
function mostCommon(tally: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of tally) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function bump(tally: Map<string, number>, key: string) {
  tally.set(key, (tally.get(key) ?? 0) + 1);
}

/**
 * The colours `products` really come in: one entry per distinct colour name
 * (case-insensitive), with how many products have it, most common first.
 * Skips the "Default" placeholder a variant-less product is given, and any
 * name the URL could not carry (see `isFacetToken`). The swatch is the
 * colour's most common real hex across products, then the shared preset
 * palette's hex for that name, then a neutral grey — never a hex that was
 * itself only a fallback.
 */
export function deriveColorFacet(products: readonly Product[]): ColorFacetOption[] {
  interface Bucket {
    spellings: Map<string, number>;
    hexes: Map<string, number>;
    count: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const product of products) {
    const countedForProduct = new Set<string>();
    for (const color of product.colors) {
      const name = color.name.trim();
      const key = normalizeFacetValue(name);
      if (key === "default" || !isFacetToken(name)) continue;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { spellings: new Map(), hexes: new Map(), count: 0 };
        buckets.set(key, bucket);
      }
      bump(bucket.spellings, name);
      const hex = color.hex?.trim().toLowerCase();
      if (hex && HEX_COLOR_PATTERN.test(hex) && hex !== PLACEHOLDER_COLOR_HEX.toLowerCase()) {
        bump(bucket.hexes, hex);
      }
      if (!countedForProduct.has(key)) {
        countedForProduct.add(key);
        bucket.count += 1;
      }
    }
  }

  const options: ColorFacetOption[] = [];
  for (const bucket of buckets.values()) {
    const name = mostCommon(bucket.spellings);
    if (!name) continue;
    options.push({
      name,
      hex: mostCommon(bucket.hexes) ?? findPresetColorHex(name) ?? PLACEHOLDER_COLOR_HEX,
      count: bucket.count,
    });
  }
  return options.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The sizes `products` really come in: one entry per distinct size
 * (case-insensitive) in the catalogue's canonical order (XS-3XL, then
 * numeric school sizes, then kids' age bands, then linen sizes) — the same
 * `compareSizes` the PDP uses — each with how many products have it.
 */
export function deriveSizeFacet(products: readonly Product[]): SizeFacetOption[] {
  interface Bucket {
    spellings: Map<string, number>;
    count: number;
  }
  const buckets = new Map<string, Bucket>();

  for (const product of products) {
    const countedForProduct = new Set<string>();
    for (const size of product.sizes) {
      const value = size.trim();
      const key = normalizeFacetValue(value);
      if (!isFacetToken(value)) continue;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { spellings: new Map(), count: 0 };
        buckets.set(key, bucket);
      }
      bump(bucket.spellings, value);
      if (!countedForProduct.has(key)) {
        countedForProduct.add(key);
        bucket.count += 1;
      }
    }
  }

  const options: SizeFacetOption[] = [];
  for (const bucket of buckets.values()) {
    const value = mostCommon(bucket.spellings);
    if (value) options.push({ value, count: bucket.count });
  }
  return options.sort((a, b) => compareSizes(a.value, b.value));
}

/** A slider step that gives roughly 20-100 stops across a span of INR
 * prices, in round amounts a shopper would recognise. */
function priceStepFor(span: number): number {
  if (span <= 200) return 5;
  if (span <= 1000) return 10;
  if (span <= 5000) return 50;
  if (span <= 20000) return 100;
  return 500;
}

/**
 * The slider range for a max-price filter over `products`: it starts at the
 * cheapest product's price (rounded up to a whole rupee, so that product is
 * still listed at the slider's lowest stop) and ends on a whole number of
 * steps at or above the dearest one — landing exactly on a step is what lets
 * the top stop be reached, and the top stop means "no limit". `null` when
 * every product costs the same (or there are none): there is nothing to
 * narrow.
 */
export function derivePriceFacet(products: readonly Product[]): PriceFacet | null {
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const product of products) {
    if (!Number.isFinite(product.price) || product.price < 0) continue;
    lowest = Math.min(lowest, product.price);
    highest = Math.max(highest, product.price);
  }

  const min = Math.ceil(lowest);
  const top = Math.ceil(highest);
  if (!Number.isFinite(min) || !Number.isFinite(top) || top <= min) return null;

  const step = priceStepFor(top - min);
  return { min, max: min + Math.ceil((top - min) / step) * step, step };
}

/**
 * Every facet the filter panel offers, derived from `products`. Colours and
 * sizes are scoped to `options.category` (and its sub-categories, via
 * `options.categoryDescendants`) so a category's chips only list what it
 * really has — Kids Wear shows age bands, not S-3XL. The price range is
 * derived from all of `products`, so it stays put as the category facet
 * changes and a shared `?price=` link keeps its meaning.
 */
export function deriveShopFacets(
  products: readonly Product[],
  options?: { category?: string; categoryDescendants?: Record<string, string[]> },
): ShopFacets {
  const category = options?.category;
  const scoped = category
    ? products.filter((product) => inCategory(product, category, options?.categoryDescendants))
    : products;
  return {
    colors: deriveColorFacet(scoped),
    sizes: deriveSizeFacet(scoped),
    price: derivePriceFacet(products),
  };
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
//   colors  - comma-separated color names   ?colors=Navy,Hunter+Green
//   sizes   - comma-separated sizes         ?sizes=M,L (or 2-3Y, 28, Standard...)
//   fabrics - comma-separated fabric ids    ?fabrics=4-way-stretch
//   price   - single integer (max price)    ?price=1500 (absent = no limit)
//   sale    - boolean flag ("1" or absent)  ?sale=1
//   stock   - boolean flag ("1" or absent)  ?stock=1
//   sort    - existing SortOption union     ?sort=price-asc
//   show    - how many cards "Load more" has revealed (F-021): ?show=48
//   category, q - unchanged, pre-existing
//
// Parsing is defensive end to end: every value is validated against an
// allow-list (fabrics/sort), a shape check (colors/sizes — their real values
// live in the catalogue, not in code; see `isFacetToken`), a numeric check
// (price) or strictly boolean (sale/stock) before use, multi-value lists are
// capped, and the whole thing is wrapped in try/catch — a malformed or
// hostile query string can only ever fall back to `defaultShopFilters`,
// never throw. See filters.test.ts for the "junk params" coverage.
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

/** Keeps only tokens `accepts`, de-duplicated (by `keyOf`) and order
 * preserved. Anything rejected (typos, garbage, script/SQLi lookalikes) is
 * silently dropped rather than rejecting the whole param — one bad value in
 * a multi-select shouldn't cost the others. */
function parseList(
  raw: string | null,
  accepts: (token: string) => boolean,
  keyOf: (token: string) => string = (token) => token,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of splitList(raw)) {
    const key = keyOf(token);
    if (accepts(token) && !seen.has(key)) {
      seen.add(key);
      result.push(token);
    }
  }
  return result;
}

/** A `?price=` at or above this is no real price cap — it is parsed as "no
 * limit" rather than echoed back as an absurd "Under INR 99999999999" chip. */
const MAX_PRICE_PARAM = 10_000_000;

function parsePriceMax(raw: string | null): number {
  if (!raw) return defaultShopFilters.priceMax;
  const parsed = Number(raw);
  // The catalogue's own range isn't known here, so there is nothing to clamp
  // to (clamping to a fixed range is what made `?price=500` jump to 2,499
  // and left an INR 149-2,999 catalogue with no usable slider, F-094). Any
  // positive amount is a valid cap; garbage, zero/negative and absurdly
  // large values fall back to the default, "no limit".
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= MAX_PRICE_PARAM) {
    return defaultShopFilters.priceMax;
  }
  return Math.round(parsed);
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
      colors: parseList(safeGet(params, "colors"), isFacetToken, normalizeFacetValue),
      sizes: parseList(safeGet(params, "sizes"), isFacetToken, normalizeFacetValue),
      fabrics: parseList(safeGet(params, "fabrics"), (token) => VALID_FABRIC_IDS.has(token)),
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

/** How many product cards a listing renders before its first "Load more"
 * (F-021/F-242: /shop used to render every product at once — about 45,000px
 * of mobile scroll for ~57 products). 24 is 6 rows at the desktop
 * `xl:grid-cols-4` width and 12 rows at the 2-column phone width. */
export const SHOP_PAGE_SIZE = 24;

/** Upper bound for a `?show=` value read back from the URL, so a hand-edited
 * or hostile link can't make the grid render an unbounded number of cards. */
const MAX_VISIBLE_COUNT = 480;

/**
 * Parses `?show=` — how many cards a shopper had "Load more"d to — so that
 * going back from a product page (which remounts the listing) restores the
 * same list instead of collapsing it to the first page and leaving the
 * browser's restored scroll position pointing at the wrong place. Anything
 * missing, non-numeric or not larger than one page is just the first page;
 * anything larger is rounded up to a whole number of pages and capped.
 */
export function parseShopVisibleCount(
  params: SearchParamsLike | null | undefined,
  pageSize: number = SHOP_PAGE_SIZE,
): number {
  const raw = safeGet(params, "show");
  if (!raw) return pageSize;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= pageSize) return pageSize;
  return Math.ceil(Math.min(parsed, MAX_VISIBLE_COUNT) / pageSize) * pageSize;
}

/** Returns a clone of `current` with `?show=` set to `count` — or removed
 * when `count` is just the first page, so an untouched listing never grows
 * a query string. Every other param is left as it was. */
export function withShopVisibleCount(
  current: string,
  count: number,
  pageSize: number = SHOP_PAGE_SIZE,
): URLSearchParams {
  const params = new URLSearchParams(current);
  setOrDelete(params, "show", count > pageSize ? String(count) : undefined);
  return params;
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
  // Any facet/sort/search change starts the listing over on its first page
  // (see ProductGrid), so a stale `?show=` must not outlive it.
  params.delete("show");

  return params;
}
