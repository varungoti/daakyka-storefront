import { revalidateTag, unstable_cache } from "next/cache";
import {
  bestSellers as seedBestSellers,
  getProductsByCategory as seedGetProductsByCategory,
  products as seedProducts,
} from "@/data/products";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { FabricTech, Product, ProductColor, ProductImage, ProductVariant } from "@/lib/types";
import { descriptionToPlainText, descriptionToSafeHtml } from "@/lib/catalog/description-html";
import { colorPresetIndex, compareSizes } from "@/lib/catalog/size-presets";
import { isProduction } from "@/lib/env";

/**
 * Phase B3: the storefront's product/category read path, backed by
 * Prisma. The DB is the sole source of truth for catalog data — the
 * Shopify Storefront-API client/queries/mappers this module used to be
 * able to fall back to were removed as dead code (release-hardening,
 * audit finding F5): that path was never wired to real DB products
 * (Shopify GIDs vs. Prisma cuids) and had no callers left anywhere in the
 * app. `src/lib/shopify/` still exists for the unrelated, working order
 * webhook (see src/app/api/webhooks/shopify/orders/route.ts).
 *
 * Every exported read helper:
 *  - only ever returns `status: ACTIVE` products from `active` categories
 *    to the storefront (drafts and archived products never leak out here).
 *  - is cached with `unstable_cache` tagged "products" (plus a per-slug
 *    tag for single-product lookups), with a graceful fallback to an
 *    uncached direct query when `unstable_cache` has no request/build
 *    scope to attach to (unit tests, standalone scripts) — see
 *    src/lib/settings/index.ts for the same pattern.
 *  - falls back to the legacy `src/data/products.ts` seed catalog when
 *    the DB has zero ACTIVE products, or the query throws, so the site
 *    keeps rendering during the transition to the DB-backed catalog. A
 *    warning is logged once (not per-request) when that happens.
 */

export const PRODUCTS_CACHE_TAG = "products";
export const CATEGORIES_CACHE_TAG = "categories";

export function productCacheTag(slug: string): string {
  return `product-${slug}`;
}

const PRODUCT_INCLUDE = {
  category: true,
  variants: true,
  images: { include: { media: true }, orderBy: { sortOrder: "asc" } },
  reviews: { where: { status: "APPROVED" }, select: { rating: true } },
} satisfies Prisma.ProductInclude;

type DbProduct = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

export interface CategoryTreeNode {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  section: "HOSPITAL" | "SCHOOL" | "KIDS" | "GENERAL";
  sortOrder: number;
  showInMenu: boolean;
  image: { url: string; alt: string | null } | null;
  children: CategoryTreeNode[];
}

export interface GetProductsOptions {
  categorySlug?: string;
  section?: "HOSPITAL" | "SCHOOL" | "KIDS" | "GENERAL";
  onSale?: boolean;
  featured?: boolean;
  search?: string;
  limit?: number;
}

const PLACEHOLDER_PRODUCT_IMAGE = "/placeholder-product.svg";

// ---------------------------------------------------------------------------
// Fallback-source tracking + one-time warning
// ---------------------------------------------------------------------------

let lastProductSource: "db" | "seed" = "db";
let warnedFallback = false;

function warnFallbackOnce(reason: string) {
  lastProductSource = "seed";
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(
    `[lib/products] Falling back to the legacy seed catalog (src/data/products.ts): ${reason}. ` +
      "Run `npm run db:seed:catalog -- --publish` to populate real ACTIVE products.",
  );
}

/** Best-effort indicator of where the last successful catalog read came
 * from — used by /api/health and the admin intelligence page as a
 * diagnostic, not a strict real-time guarantee. */
export function getProductSource(): "db" | "seed" {
  return lastProductSource;
}

// ---------------------------------------------------------------------------
// DB -> UI Product mapping
// ---------------------------------------------------------------------------

/**
 * release-hardening audit F-092: the DB catalog has never populated
 * `fabricTech`, so the Fabric Technology filter always returned zero
 * products. `tags` is the closest admin-editable signal today — a small
 * alias table maps the tag spellings actually in use onto the storefront's
 * fixed `FabricTech` ids. Kept deliberately narrow (exact tag match, plus
 * one tightly-scoped keyword match on the free-text `fabric` field for
 * "fluid-resistant" products that only state it there, e.g. the OT gowns)
 * so this never mislabels a product that merely mentions "stretch" fabric
 * in passing.
 */
const FABRIC_TECH_TAG_ALIASES: Record<string, FabricTech> = {
  antimicrobial: "anti-microbial",
  "anti-microbial": "anti-microbial",
  "liquid-repellent": "liquid-repellent",
  "fluid-resistant": "liquid-repellent",
  "fluid-repellent": "liquid-repellent",
  "4-way-stretch": "4-way-stretch",
  "four-way-stretch": "4-way-stretch",
  "2-way-stretch": "2-way-stretch",
  "two-way-stretch": "2-way-stretch",
  "moisture-wicking": "moisture-wicking",
  "eco-flex": "eco-flex",
};

const FLUID_RESISTANT_FABRIC_PATTERN = /fluid[- ]?(resistant|repellent)/i;

function deriveFabricTech(tags: string[], fabric: string | null): FabricTech[] {
  const result = new Set<FabricTech>();
  for (const tag of tags) {
    const alias = FABRIC_TECH_TAG_ALIASES[tag.trim().toLowerCase()];
    if (alias) result.add(alias);
  }
  if (fabric && FLUID_RESISTANT_FABRIC_PATTERN.test(fabric)) {
    result.add("liquid-repellent");
  }
  return [...result];
}

function mapDbProductToUi(p: DbProduct): Product {
  // release-hardening audit F-024: Postgres has no defined row order for
  // `variants`/`images`, so a card or PDP that read them straight off the
  // DB got whatever order the index happened to return — alphabetical in
  // practice ("2XL L M S XL", 2XL pre-selected). Sort once here, and
  // derive every size/colour/variant-order field below from these ordered
  // lists, so every consumer agrees on the same order.
  const imageColorOrder = new Map<string, number>();
  for (const img of p.images) {
    if (img.color && !imageColorOrder.has(img.color)) imageColorOrder.set(img.color, imageColorOrder.size);
  }
  const compareColorNames = (a: string, b: string): number => {
    const orderA = imageColorOrder.get(a);
    const orderB = imageColorOrder.get(b);
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    const presetA = colorPresetIndex(a);
    const presetB = colorPresetIndex(b);
    if (presetA !== undefined && presetB !== undefined) return presetA - presetB;
    if (presetA !== undefined) return -1;
    if (presetB !== undefined) return 1;
    return a.localeCompare(b);
  };

  const orderedDbVariants = [...p.variants].sort(
    (a, b) =>
      compareSizes(a.size, b.size) ||
      compareColorNames(a.color, b.color) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );

  const variants: ProductVariant[] = orderedDbVariants.map((v) => ({
    id: v.id,
    title: `${v.size} / ${v.color}`,
    price: v.price !== null ? Number(v.price) : Number(p.price),
    compareAtPrice: p.compareAtPrice !== null ? Number(p.compareAtPrice) : undefined,
    available: v.active && v.stock > 0,
    selectedOptions: [
      { name: "Size", value: v.size },
      { name: "Color", value: v.color },
    ],
    stock: v.stock,
    size: v.size,
    color: v.color,
    colorHex: v.colorHex ?? undefined,
  }));

  const sizes = [...new Set(orderedDbVariants.map((v) => v.size))].sort(compareSizes);

  const colorHexByName = new Map<string, string>();
  for (const v of orderedDbVariants) {
    if (v.colorHex && !colorHexByName.has(v.color)) colorHexByName.set(v.color, v.colorHex);
  }
  const colorNames = [...new Set(orderedDbVariants.map((v) => v.color))].sort(compareColorNames);

  const images: ProductImage[] =
    p.images.length > 0
      ? p.images.map((img) => ({
          url: img.media.url,
          alt: img.alt ?? p.name,
          color: img.color ?? undefined,
        }))
      : [{ url: PLACEHOLDER_PRODUCT_IMAGE, alt: p.name }];

  // release-hardening audit F-016: the product card's photo, colour label
  // and Quick Add colour used to be computed independently — `images[0]`
  // for the photo, `colors[0]` (built from the unordered variant rows) for
  // the label and Quick Add — and could disagree (a red hoodie
  // photographed first but labelled "Grey" because "Grey" happened to sort
  // first). `defaultColor` is the one colour every one of those now reads
  // from: the hero image's own colour when it's a real, in-stock option,
  // otherwise the first in-stock colour, otherwise just the first colour.
  const firstAvailableColor = colorNames.find((name) =>
    orderedDbVariants.some((v) => v.color === name && v.active && v.stock > 0),
  );
  const imageFirstColor = p.images.find((img) => img.color)?.color ?? undefined;
  const defaultColor =
    imageFirstColor &&
    colorNames.includes(imageFirstColor) &&
    orderedDbVariants.some((v) => v.color === imageFirstColor && v.active && v.stock > 0)
      ? imageFirstColor
      : (firstAvailableColor ?? colorNames[0] ?? "Default");

  const colors: ProductColor[] =
    colorNames.length > 0
      ? [defaultColor, ...colorNames.filter((name) => name !== defaultColor)].map((name) => ({
          name,
          hex: colorHexByName.get(name) ?? "#CBD5E1",
        }))
      : [{ name: "Default", hex: "#CBD5E1" }];

  const defaultColorImage = images.find((img) => img.color === defaultColor);

  const reviewCount = p.reviews.length;
  const ratingAverage =
    reviewCount > 0
      ? p.reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
      : 0;

  const price = Number(p.price);
  const compareAtPrice = p.compareAtPrice !== null ? Number(p.compareAtPrice) : undefined;
  const onSale = compareAtPrice !== undefined && compareAtPrice > price;

  // F-12 (docs/audit-2026-09-19/admin-ux.md): `p.description` may now be
  // sanitized rich-text HTML *or* one of the pre-existing plain-text rows —
  // both projections below handle either shape safely (see
  // src/lib/catalog/description-html.ts), so every consumer of `Product`
  // gets the right guarantee for its context without re-deriving it.
  const rawDescription = p.description ?? p.shortDescription ?? null;

  return {
    id: p.id,
    handle: p.slug,
    name: p.name,
    description: descriptionToPlainText(rawDescription) || undefined,
    descriptionHtml: rawDescription ? descriptionToSafeHtml(rawDescription) : undefined,
    // release-hardening audit F-111: a short, hand-written teaser distinct
    // from the (possibly identical) long description above — see
    // product-detail.tsx, which now renders this instead of repeating
    // `description` above the accordion.
    shortDescription: p.shortDescription ? descriptionToPlainText(p.shortDescription) || undefined : undefined,
    colorName: defaultColor,
    price,
    compareAtPrice,
    rating: ratingAverage,
    reviewCount,
    ratingAverage,
    category: p.category.slug,
    categorySlug: p.category.slug,
    categoryName: p.category.name,
    section: p.category.section,
    colors,
    sizes,
    fabricTech: deriveFabricTech(p.tags, p.fabric),
    image: defaultColorImage?.url ?? images[0]?.url ?? PLACEHOLDER_PRODUCT_IMAGE,
    images,
    badge: p.featured ? "best-seller" : p.isNew ? "new" : undefined,
    gender: p.gender.toLowerCase(),
    variants,
    defaultVariantId:
      orderedDbVariants.find((v) => v.color === defaultColor && v.active && v.stock > 0)?.id ?? variants[0]?.id,
    // F-028: a DB-backed product with zero variants used to count as
    // "available" (the `variants.length === 0` half of this used to be
    // `true`), so it showed a working Add to Cart that added a fake
    // `seed-<id>` line checkout could never actually resolve. Zero
    // variants now means unavailable; a real product always has at least
    // one (publishProduct/createProduct/updateProduct all reject
    // publishing one that doesn't — see src/lib/catalog/products.ts).
    available: variants.some((v) => v.available),
    onSale,
    fabric: p.fabric ?? undefined,
    care: p.care ?? undefined,
    featured: p.featured,
    isNew: p.isNew,
    tags: p.tags,
    createdAt: p.createdAt.toISOString(),
    seoTitle: p.seoTitle ?? undefined,
    seoDescription: p.seoDescription ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Category tree
// ---------------------------------------------------------------------------

interface FlatCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  section: "HOSPITAL" | "SCHOOL" | "KIDS" | "GENERAL";
  parentId: string | null;
  sortOrder: number;
  showInMenu: boolean;
  image: { url: string; alt: string | null } | null;
}

async function fetchActiveCategoriesFlat(): Promise<FlatCategory[]> {
  return db.category.findMany({
    where: { active: true },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      section: true,
      parentId: true,
      sortOrder: true,
      showInMenu: true,
      image: { select: { url: true, alt: true } },
    },
    orderBy: { sortOrder: "asc" },
  });
}

function buildCategoryTree(flat: FlatCategory[]): CategoryTreeNode[] {
  const nodeById = new Map<string, CategoryTreeNode>(
    flat.map((c) => [
      c.id,
      {
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        section: c.section,
        sortOrder: c.sortOrder,
        showInMenu: c.showInMenu,
        image: c.image,
        children: [],
      },
    ]),
  );

  const roots: CategoryTreeNode[] = [];
  for (const c of flat) {
    const node = nodeById.get(c.id)!;
    if (!c.parentId) {
      roots.push(node);
    } else if (nodeById.has(c.parentId)) {
      nodeById.get(c.parentId)!.children.push(node);
    }
    // release-hardening audit F-099: `c.parentId` set but not in
    // `nodeById` means the parent is inactive (or missing) — this node is
    // dropped rather than promoted to a root. It's never attached to
    // `roots` or to any node that is, so its own children (walked by the
    // same rule, on a later iteration of this loop) are unreachable from
    // `roots` too: pruning one level cascades to the whole subtree without
    // needing to recurse. Deactivating a parent category now hides its
    // still-active children from the nav, /shop's filters and listings —
    // not just the parent itself.
  }

  const sortRec = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  return roots;
}

// release-hardening audit F-271: tags alone mean this only ever refreshes
// when an admin catalog write calls revalidateTag — a category published
// or edited any other way (a seed/publish script, a direct DB write) stays
// cached under the old snapshot indefinitely. `revalidate` is a safety net
// on top of the tags, not a replacement for them: an admin save still
// invalidates immediately, and this just bounds how stale things can ever
// get otherwise.
const CATALOG_CACHE_REVALIDATE_SECONDS = 300;

const cachedCategoryTree = unstable_cache(
  async () => buildCategoryTree(await fetchActiveCategoriesFlat()),
  ["category-tree"],
  { tags: [CATEGORIES_CACHE_TAG], revalidate: CATALOG_CACHE_REVALIDATE_SECONDS },
);

/** The full active category tree (top-level categories with nested
 * children), sorted by sortOrder. Includes categories with
 * `showInMenu: false` (e.g. corporate-uniforms) — callers that render a
 * menu should filter on `showInMenu` themselves. */
export async function getCategoryTree(): Promise<CategoryTreeNode[]> {
  try {
    return await cachedCategoryTree();
  } catch {
    try {
      return await buildCategoryTree(await fetchActiveCategoriesFlat());
    } catch {
      return [];
    }
  }
}

/**
 * release-hardening audit F-046: an uncached, exception-propagating read of
 * the category tree — used only by src/app/sitemap.ts. Unlike
 * `getCategoryTree` above (which every page's nav calls, and which must
 * never turn a transient DB blip into a 500 on every request), the sitemap
 * is rebuilt rarely and its correctness matters more than availability: a
 * thrown error here fails a bad build loudly instead of letting `[]` (from
 * the graceful fallback) get cached as a "successful" sitemap with zero
 * category URLs, which then stays wrong indefinitely (revalidate=false
 * metadata routes only rebuild on a tag revalidation).
 */
export async function getCategoryTreeStrict(): Promise<CategoryTreeNode[]> {
  return buildCategoryTree(await fetchActiveCategoriesFlat());
}

function flattenTree(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.flatMap((n) => [n, ...flattenTree(n.children)]);
}

export async function getCategoryBySlug(slug: string): Promise<CategoryTreeNode | null> {
  const tree = await getCategoryTree();
  return flattenTree(tree).find((c) => c.slug === slug) ?? null;
}

/** The category's own id plus every descendant category's id, for
 * "products in this category or any sub-category" queries. Returns an
 * empty array when the slug doesn't exist in the DB category tree (the
 * caller decides what that means — see getProductsByCategory's legacy
 * fallback for old seed-only category slugs like "bespoke"). */
async function getSelfAndDescendantCategoryIds(slug: string): Promise<string[]> {
  const tree = await getCategoryTree();
  const flat = flattenTree(tree);
  const root = flat.find((c) => c.slug === slug);
  if (!root) return [];

  const ids: string[] = [];
  const collect = (node: CategoryTreeNode) => {
    ids.push(node.id);
    for (const child of node.children) collect(child);
  };

  // Find the root node's actual subtree (with children) from the tree,
  // not the flattened copy (which has children too, since flattenTree
  // just walks and doesn't strip them — either works, kept for clarity).
  collect(root);
  return ids;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

async function queryActiveProductsFromDb(
  options: GetProductsOptions,
  // Defaults to the cached, graceful-fallback tree read; getProductsStrict
  // (below, used only by the sitemap) passes getCategoryTreeStrict instead
  // so a DB error propagates rather than silently resolving to "no visible
  // categories, so no products" as getCategoryTree's own [] fallback would.
  categoryTreeFn: () => Promise<CategoryTreeNode[]> = getCategoryTree,
): Promise<Product[]> {
  // release-hardening audit F-099: restrict to categories actually
  // reachable from the (pruned) active category tree, not just "this
  // product's own category is active". A still-active child category
  // whose parent was just deactivated is no longer reachable from any
  // root (see buildCategoryTree's pruning above), but the child's own
  // `active` flag never changed — so the old `category: { active: true }`
  // filter kept serving its products to /shop, the top-level filter chips
  // and the mega-menu even though the category itself had become an
  // orphaned dead end (its own page 404s once it's not in the tree).
  let categoryIds: string[];
  if (options.categorySlug) {
    categoryIds = await getSelfAndDescendantCategoryIds(options.categorySlug);
    if (categoryIds.length === 0) return [];
  } else {
    categoryIds = flattenTree(await categoryTreeFn()).map((c) => c.id);
    if (categoryIds.length === 0) return [];
  }

  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    categoryId: { in: categoryIds },
    ...(options.section ? { category: { section: options.section } } : {}),
  };

  if (options.featured) {
    where.featured = true;
  }

  if (options.search) {
    const q = options.search.trim();
    if (q.length > 0) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { shortDescription: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase() } },
      ];
    }
  }

  const rows = await db.product.findMany({
    where,
    include: PRODUCT_INCLUDE,
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    // onSale is filtered in memory below (it compares two columns, which
    // Prisma can't express without a raw query) — fetch a bit more than
    // the requested limit so filtering doesn't under-fill the page. The
    // catalog is small enough (dozens, not thousands, of products) that
    // this stays cheap.
    take: options.onSale && options.limit ? undefined : options.limit,
  });

  let mapped = rows.map(mapDbProductToUi);

  if (options.onSale) {
    mapped = mapped.filter((p) => p.onSale);
    if (options.limit) mapped = mapped.slice(0, options.limit);
  }

  return mapped;
}

function fallbackProducts(options: GetProductsOptions): Product[] {
  let result = options.categorySlug
    ? seedGetProductsByCategory(options.categorySlug)
    : [...seedProducts];

  if (options.section) {
    // The legacy seed catalog predates CategorySection — it has no
    // section field to filter on, so a section filter against the
    // fallback simply yields nothing rather than guessing.
    result = [];
  }
  if (options.featured) {
    result = result.filter((p) => p.badge === "best-seller");
  }
  if (options.onSale) {
    result = result.filter((p) => p.compareAtPrice !== undefined && p.compareAtPrice > p.price);
  }
  if (options.search) {
    const q = options.search.trim().toLowerCase();
    if (q.length > 0) {
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
      );
    }
  }
  if (options.limit) {
    result = result.slice(0, options.limit);
  }
  return result;
}

const cachedGetProducts = unstable_cache(
  async (optionsJson: string) => queryActiveProductsFromDb(JSON.parse(optionsJson)),
  ["products-query"],
  { tags: [PRODUCTS_CACHE_TAG], revalidate: CATALOG_CACHE_REVALIDATE_SECONDS },
);

/**
 * release-hardening audit F-046: the legacy seed catalog (fabricated
 * ratings/review counts, links that 404, addable-to-cart lines checkout
 * can never resolve — see F-003) was only ever meant to keep the site
 * rendering during the transition to the DB-backed catalog. In production,
 * where that transition is long over, falling back to it on a transient DB
 * error or an empty result set means real shoppers can be shown fake
 * products instead of an honest empty/error state. Gated on `isProduction()`
 * rather than removed outright so local dev/tests (no seeded DB yet) and a
 * self-hosted staging deploy keep the old graceful-degradation behaviour.
 */
function shouldUseSeedFallback(): boolean {
  return !isProduction();
}

export async function getProducts(options: GetProductsOptions = {}): Promise<Product[]> {
  const key = JSON.stringify(options);
  let rows: Product[];

  try {
    try {
      rows = await cachedGetProducts(key);
    } catch {
      // unstable_cache needs Next's data cache / request store, which
      // isn't present outside an actual Next server (unit tests, one-off
      // scripts) — fall back to an uncached direct query.
      rows = await queryActiveProductsFromDb(options);
    }
  } catch (error) {
    warnFallbackOnce(`DB query failed (${error instanceof Error ? error.message : String(error)})`);
    return shouldUseSeedFallback() ? fallbackProducts(options) : [];
  }

  if (rows.length === 0) {
    // Not necessarily an error — most likely the draft catalog hasn't
    // been published yet (still all DRAFT) or this specific filter
    // legitimately has no matches. Only treat "zero ACTIVE products at
    // all" as the fallback trigger; an empty result for a narrow filter
    // (e.g. a real but currently-empty category) is a normal empty state.
    if (Object.keys(options).length === 0) {
      warnFallbackOnce("the database has zero ACTIVE products");
      return shouldUseSeedFallback() ? fallbackProducts(options) : [];
    }
    const totalActive = await countActiveProducts();
    if (totalActive === 0) {
      warnFallbackOnce("the database has zero ACTIVE products");
      return shouldUseSeedFallback() ? fallbackProducts(options) : [];
    }
  } else {
    lastProductSource = "db";
  }

  return rows;
}

/**
 * release-hardening audit F-046: an uncached, exception-propagating,
 * never-seed-fallback read of the full active catalog — used only by
 * src/app/sitemap.ts. See getCategoryTreeStrict's doc comment for why the
 * sitemap needs this instead of the graceful `getProducts()` every other
 * page uses: a DB error here should fail a bad build/regeneration loudly,
 * not get cached as a "successful" sitemap listing 8 seed-catalog handles
 * that 404 on every real (DB-backed) product page.
 */
export async function getProductsStrict(): Promise<Product[]> {
  return queryActiveProductsFromDb({}, getCategoryTreeStrict);
}

async function countActiveProducts(): Promise<number> {
  try {
    return await db.product.count({ where: { status: "ACTIVE" } });
  } catch {
    return 0;
  }
}

async function queryProductByHandleFromDb(handle: string): Promise<Product | null> {
  const row = await db.product.findFirst({
    where: { slug: handle, status: "ACTIVE", category: { active: true } },
    include: PRODUCT_INCLUDE,
  });
  return row ? mapDbProductToUi(row) : null;
}

export async function getProductByHandle(handle: string): Promise<Product | null> {
  const cached = unstable_cache(
    () => queryProductByHandleFromDb(handle),
    ["product-by-handle", handle],
    { tags: [PRODUCTS_CACHE_TAG, productCacheTag(handle)], revalidate: CATALOG_CACHE_REVALIDATE_SECONDS },
  );

  let result: Product | null;
  try {
    try {
      result = await cached();
    } catch {
      result = await queryProductByHandleFromDb(handle);
    }
  } catch (error) {
    warnFallbackOnce(`DB query failed (${error instanceof Error ? error.message : String(error)})`);
    return shouldUseSeedFallback() ? (seedProducts.find((p) => p.handle === handle) ?? null) : null;
  }

  if (result) {
    lastProductSource = "db";
    return result;
  }

  // Not found among ACTIVE DB products — check whether the DB has any
  // ACTIVE products at all before deciding this is a real 404 vs. the
  // transitional state where the whole catalog still needs seeding.
  const totalActive = await countActiveProducts();
  if (totalActive === 0) {
    warnFallbackOnce("the database has zero ACTIVE products");
    return shouldUseSeedFallback() ? (seedProducts.find((p) => p.handle === handle) ?? null) : null;
  }
  return null;
}

export async function getBestSellers(): Promise<Product[]> {
  const featured = await getProducts({ featured: true, limit: 4 });
  if (featured.length > 0) return featured;
  const fallback = await getProducts({ limit: 4 });
  if (fallback.length > 0) return fallback;
  return shouldUseSeedFallback() ? seedBestSellers : [];
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  return getProducts({ featured: true, limit });
}

/**
 * Products in a category, including its descendant categories (e.g.
 * "for-hospitals" also returns "scrub-sets", "hospital-linens" ->
 * "bedsheets", etc).
 *
 * release-hardening audit F-003: a slug with no DB category equivalent
 * (old seed-only categories like "tops" or "bespoke", still linked from a
 * couple of legacy pages) used to fall back to the legacy seed catalog —
 * fabricated ratings/review counts, PDP links that 404, and an
 * "add to cart" that checkout can never actually resolve. Real shoppers
 * hit this on production (/shop/bespoke, /guides/scrub-tops). There is no
 * legitimate case for showing that data to a shopper, so this now always
 * returns an empty result for an unknown slug — every caller already
 * renders a normal empty state for "no products in this category".
 */
export async function getProductsByCategory(categorySlug?: string): Promise<Product[]> {
  if (!categorySlug) return getProducts();

  const category = await getCategoryBySlug(categorySlug);
  if (!category) return [];

  return getProducts({ categorySlug });
}

// ---------------------------------------------------------------------------
// Stock-change cache invalidation (release-hardening audit F-017 / F-271)
//
// Checkout, payment verification and admin cancel/restock all mutate
// ProductVariant.stock directly against the DB — none of them ever
// invalidated the cached catalog, so a PDP or listing could keep showing
// pre-sale stock/availability indefinitely (until an unrelated admin
// catalog edit happened to revalidate the same tags). The
// `CATALOG_CACHE_REVALIDATE_SECONDS` TTL above is a bound on how stale
// things can ever get; this is the immediate fix for the common case
// (an order actually happening) — every stock-mutating call site below
// calls this once its transaction has committed.
// ---------------------------------------------------------------------------

/**
 * The actual revalidateTag calls for a set of product slugs, split out
 * from revalidateProductStockForVariants below (which resolves variant ids
 * to slugs via the DB first) so this half — the exact tags and profiles
 * passed to revalidateTag — is independently unit-testable. next/cache's
 * exports are non-configurable accessor properties and this project's
 * tests run as real ESM (import bindings can't be reassigned either), so
 * nothing in `next/cache` can be spied on from a test; callers inject a
 * fake `revalidate` instead (see src/lib/homepage/index.ts's
 * revalidateHomepageCache for the same pattern). Production callers always
 * use the default (the real revalidateTag).
 *
 * Per-slug tag uses `{ expire: 0 }` so the very next PDP request gets the
 * real stock instead of one more stale render; the broad "products"
 * listings tag uses `"max"` — one more stale /shop or home-page render is
 * an acceptable trade for not blocking every listing render on every
 * single order.
 */
export function revalidateProductStockTags(
  slugs: Iterable<string>,
  revalidate: (tag: string, profile: string | { expire: number }) => void = revalidateTag,
): void {
  const safeRevalidate = (tag: string, profile: string | { expire: number }) => {
    try {
      revalidate(tag, profile);
    } catch {
      // No static-generation/request store in this context (unit/
      // integration tests, one-off scripts, a background job) — nothing to
      // revalidate.
    }
  };

  const uniqueSlugs = new Set(slugs);
  if (uniqueSlugs.size === 0) return;
  for (const slug of uniqueSlugs) {
    safeRevalidate(productCacheTag(slug), { expire: 0 });
  }
  safeRevalidate(PRODUCTS_CACHE_TAG, "max");
}

/**
 * Call once a stock-mutating transaction (an ORDER_REQUEST decrement, a
 * Razorpay payment decrement, or a cancellation/refund restock) has
 * committed, passing the variant ids it touched. Resolves each to its
 * product's slug and hands them to revalidateProductStockTags above.
 *
 * Best-effort only, by design: a cache-revalidation failure must never fail
 * the order/payment/cancellation it's called from. A DB error resolving
 * variant ids to slugs is swallowed here; a revalidateTag failure is
 * swallowed inside revalidateProductStockTags.
 */
export async function revalidateProductStockForVariants(
  variantIds: readonly string[],
  revalidate: (tag: string, profile: string | { expire: number }) => void = revalidateTag,
): Promise<void> {
  const uniqueIds = [...new Set(variantIds)];
  if (uniqueIds.length === 0) return;

  let slugs: string[];
  try {
    const rows = await db.productVariant.findMany({
      where: { id: { in: uniqueIds } },
      select: { product: { select: { slug: true } } },
    });
    slugs = rows.map((row) => row.product.slug);
  } catch {
    return;
  }

  revalidateProductStockTags(slugs, revalidate);
}
