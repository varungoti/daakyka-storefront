import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import pg from "pg";
import { assertDisposableEnvironment } from "../../../scripts/lib/assert-disposable-db.mjs";
import { resolveAdminCredentials } from "./admin-credentials";

/**
 * A two-photo gallery for one catalogue product, for the gallery thumbnail
 * e2e test (F-253).
 *
 * The seeded CI catalogue has no product photographs, so the test used to find
 * no thumbnail to click and skip itself — in every CI run, for good. Photos
 * can only be added through the app by uploading to R2, which a test server has
 * no business touching, so on a local server this inserts the MediaAsset and
 * ProductImage rows directly (the way rbac-sessions.ts inserts its users) and
 * points them at two same-origin images that ship in /public.
 *
 * The rows are written behind the app's back, so the catalogue cache does not
 * know about them: `refreshCatalogueCache` makes the app reload the product
 * (publishing an already-published product only revalidates its cache tags).
 *
 * Refuses to run unless DATABASE_URL is a disposable local database.
 */

const KEY_PREFIX = "e2e-gallery/";
const PHOTOS = ["/placeholder-banner.svg", "/placeholder-scene.svg"];

export interface GalleryFixture {
  productId: string;
  /** Removes every row this fixture created (and any left by an interrupted run). */
  remove: () => Promise<void>;
}

export async function createGalleryFixture(slug: string): Promise<GalleryFixture> {
  assertDisposableEnvironment(process.env);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  // ProductImage.mediaId cascades, so removing the assets removes the images.
  const removeRows = () => pool.query(`DELETE FROM "MediaAsset" WHERE key LIKE $1`, [`${KEY_PREFIX}%`]);

  try {
    const product = (await pool.query<{ id: string }>(`SELECT id FROM "Product" WHERE slug = $1`, [slug])).rows[0];
    if (!product) throw new Error(`Gallery fixture: no product with slug "${slug}" in the database the tests point at.`);
    await removeRows();

    // Every colour gets the gallery, whichever one the page selects first. The
    // photos apply to all sizes, so the selected size cannot filter them out.
    const colors = (
      await pool.query<{ color: string }>(`SELECT DISTINCT color FROM "ProductVariant" WHERE "productId" = $1`, [product.id])
    ).rows.map((row) => row.color);
    if (colors.length === 0) throw new Error(`Gallery fixture: product "${slug}" has no variants.`);

    for (const color of colors) {
      for (const [index, url] of PHOTOS.entries()) {
        const mediaId = randomUUID();
        await pool.query(
          `INSERT INTO "MediaAsset" (id, key, url, alt, usage, "updatedAt") VALUES ($1, $2, $3, $4, 'PRODUCT', NOW())`,
          [mediaId, `${KEY_PREFIX}${product.id}/${randomUUID()}`, url, `E2E gallery photo ${index + 1}`],
        );
        await pool.query(
          `INSERT INTO "ProductImage" (id, "productId", "mediaId", color, "sortOrder", alt, "appliesToAllSizes", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, true, NOW())`,
          [randomUUID(), product.id, mediaId, color, index, `E2E gallery photo ${index + 1}`],
        );
      }
    }

    return {
      productId: product.id,
      remove: async () => {
        try {
          await removeRows();
        } finally {
          await pool.end();
        }
      },
    };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

/**
 * Makes the running app reload one product, by (re)publishing it as an admin:
 * publishing an ACTIVE product changes nothing but revalidates its cache tags.
 * Uses its own request context, so the admin session never reaches the
 * browser page under test.
 */
export async function refreshCatalogueCache(request: APIRequestContext, productId: string): Promise<void> {
  const { email, password } = resolveAdminCredentials();
  const login = await request.post("/api/auth/login", { data: { email, password } });
  if (!login.ok()) throw new Error(`Admin login failed (${login.status()}) — needed to refresh the catalogue cache.`);
  const refreshed = await request.post(`/api/admin/products/${productId}/publish`, { data: { action: "publish" } });
  if (!refreshed.ok()) throw new Error(`Could not refresh the product cache (${refreshed.status()}).`);
}
