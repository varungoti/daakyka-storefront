import { unstable_cache } from "next/cache";
import {
  bestSellers as seedBestSellers,
  getProductsByCategory as seedGetProductsByCategory,
  products as seedProducts,
} from "@/data/products";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { Product, ProductColor, ProductImage, ProductVariant } from "@/lib/types";
import { descriptionToPlainText, descriptionToSafeHtml } from "@/lib/catalog/description-html";

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

function mapDbProductToUi(p: DbProduct): Product {
  const variants: ProductVariant[] = p.variants.map((v) => ({
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

  const sizes = [...new Set(p.variants.map((v) => v.size))];

  const colorHexByName = new Map<string, string>();
  for (const v of p.variants) {
    if (v.colorHex && !colorHexByName.has(v.color)) colorHexByName.set(v.color, v.colorHex);
  }
  const colorNames = [...new Set(p.variants.map((v) => v.color))];
  const colors: ProductColor[] =
    colorNames.length > 0
      ? colorNames.map((name) => ({ name, hex: colorHexByName.get(name) ?? "#CBD5E1" }))
      : [{ name: "Default", hex: "#CBD5E1" }];

  const images: ProductImage[] =
    p.images.length > 0
      ? p.images.map((img) => ({
          url: img.media.url,
          alt: img.alt ?? p.name,
          color: img.color ?? undefined,
        }))
      : [{ url: PLACEHOLDER_PRODUCT_IMAGE, alt: p.name }];

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
    colorName: colors[0]?.name ?? "Default",
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
    fabricTech: [],
    image: images[0]?.url ?? PLACEHOLDER_PRODUCT_IMAGE,
    images,
    badge: p.featured ? "best-seller" : p.isNew ? "new" : undefined,
    gender: p.gender.toLowerCase(),
    variants,
    defaultVariantId: variants[0]?.id,
    available: variants.length === 0 || variants.some((v) => v.available),
    onSale,
    fabric: p.fabric ?? undefined,
    care: p.care ?? undefined,
    featured: p.featured,
    isNew: p.isNew,
    tags: p.tags,
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
    if (c.parentId && nodeById.has(c.parentId)) {
      nodeById.get(c.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortRec = (nodes: CategoryTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(roots);

  return roots;
}

const cachedCategoryTree = unstable_cache(
  async () => buildCategoryTree(await fetchActiveCategoriesFlat()),
  ["category-tree"],
  { tags: [CATEGORIES_CACHE_TAG] },
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

async function queryActiveProductsFromDb(options: GetProductsOptions): Promise<Product[]> {
  const where: Prisma.ProductWhereInput = {
    status: "ACTIVE",
    category: { active: true, ...(options.section ? { section: options.section } : {}) },
  };

  if (options.categorySlug) {
    const categoryIds = await getSelfAndDescendantCategoryIds(options.categorySlug);
    if (categoryIds.length === 0) return [];
    where.categoryId = { in: categoryIds };
  }

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
  { tags: [PRODUCTS_CACHE_TAG] },
);

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
    return fallbackProducts(options);
  }

  if (rows.length === 0) {
    // Not necessarily an error — most likely the draft catalog hasn't
    // been published yet (still all DRAFT) or this specific filter
    // legitimately has no matches. Only treat "zero ACTIVE products at
    // all" as the fallback trigger; an empty result for a narrow filter
    // (e.g. a real but currently-empty category) is a normal empty state.
    if (Object.keys(options).length === 0) {
      warnFallbackOnce("the database has zero ACTIVE products");
      return fallbackProducts(options);
    }
    const totalActive = await countActiveProducts();
    if (totalActive === 0) {
      warnFallbackOnce("the database has zero ACTIVE products");
      return fallbackProducts(options);
    }
  } else {
    lastProductSource = "db";
  }

  return rows;
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
    { tags: [PRODUCTS_CACHE_TAG, productCacheTag(handle)] },
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
    return seedProducts.find((p) => p.handle === handle) ?? null;
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
    return seedProducts.find((p) => p.handle === handle) ?? null;
  }
  return null;
}

export async function getBestSellers(): Promise<Product[]> {
  const featured = await getProducts({ featured: true, limit: 4 });
  if (featured.length > 0) return featured;
  const fallback = await getProducts({ limit: 4 });
  return fallback.length > 0 ? fallback : seedBestSellers;
}

export async function getFeaturedProducts(limit = 8): Promise<Product[]> {
  return getProducts({ featured: true, limit });
}

/**
 * Products in a category, including its descendant categories (e.g.
 * "for-hospitals" also returns "scrub-sets", "hospital-linens" ->
 * "bedsheets", etc). Unknown slugs that aren't in the DB category tree
 * at all (old seed-only categories like "tops" or "bespoke", still
 * linked from a couple of legacy pages) fall back directly to the
 * legacy seed data for that slug, regardless of how many ACTIVE DB
 * products exist overall — those pages predate the DB catalog and have
 * no DB equivalent category to be "empty" in.
 */
export async function getProductsByCategory(categorySlug?: string): Promise<Product[]> {
  if (!categorySlug) return getProducts();

  const category = await getCategoryBySlug(categorySlug);
  if (!category) {
    return seedGetProductsByCategory(categorySlug);
  }
  return getProducts({ categorySlug });
}
