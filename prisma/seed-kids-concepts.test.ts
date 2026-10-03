import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/lib/db";
import { kidsConcepts } from "../src/data/catalog/kids-concepts";
import { KIDS_CONCEPT_SEED_MARKER_KEY, seedKidsConcepts } from "./seed-kids-concepts";
import { publishProduct, ProductNotPublishableError } from "../src/lib/catalog/products";
import { findAnyAdminId } from "../tests/helpers/admin-user";
import { getKidsConceptGallery } from "../src/lib/catalog/kids-concept-gallery";

describe("Kids Wear concept seed", () => {
  it("creates twenty non-purchasable drafts exactly once and respects deletion", async () => {
    const slugs = kidsConcepts.map((concept) => concept.slug);
    const mediaPrefix = `test/kids-concepts/${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const created = await seedKidsConcepts(db);
      assert.equal(created, 20);
      const rows = await db.product.findMany({
        where: { slug: { in: slugs } },
        include: { variants: true },
      });
      assert.equal(rows.length, 20);
      for (const row of rows) {
        assert.equal(row.status, "DRAFT");
        assert.equal(Number(row.price), 0);
        assert.equal(row.variants.length, 0);
        assert.ok(row.tags.includes("concept-pending-verification"));
      }
      const first = rows[0];
      await db.productVariant.create({
        data: { productId: first.id, sku: `DK-CONCEPT-${Date.now()}`, size: "Sample", color: kidsConcepts[0].color, stock: 0 },
      });
      const adminId = await findAnyAdminId();
      await assert.rejects(() => publishProduct(first.id, adminId), ProductNotPublishableError);
      await db.product.update({ where: { id: first.id }, data: { price: 499 } });
      await assert.rejects(() => publishProduct(first.id, adminId), /Verify the physical product/);
      const previewConcept = kidsConcepts[0];
      const previewProduct = rows.find((row) => row.slug === previewConcept.slug)!;
      for (const [index, view] of ["front", "back", "detail"].entries()) {
        const key = `${mediaPrefix}/${view}.webp`;
        const media = await db.mediaAsset.create({
          data: { key, url: `/cdn/${key}`, usage: "PRODUCT", source: "AI", alt: `${previewConcept.name} ${view} AI concept` },
        });
        await db.productImage.create({
          data: { productId: previewProduct.id, mediaId: media.id, color: previewConcept.color, sortOrder: index },
        });
      }
      const gallery = await getKidsConceptGallery();
      assert.equal(gallery.length, 1);
      assert.equal(gallery[0].slug, previewConcept.slug);
      assert.equal(gallery[0].images.length, 3);
      await db.product.delete({ where: { slug: slugs[0] } });
      assert.equal(await seedKidsConcepts(db), 0);
      assert.equal(await db.product.count({ where: { slug: { in: slugs } } }), 19);
    } finally {
      await db.product.deleteMany({ where: { slug: { in: slugs } } });
      await db.mediaAsset.deleteMany({ where: { key: { startsWith: mediaPrefix } } });
      await db.siteSetting.deleteMany({ where: { key: KIDS_CONCEPT_SEED_MARKER_KEY } });
    }
  });
});
