import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { MediaSource } from "@/generated/prisma/client";
import {
  deleteUnattachedMediaAsset,
  getHeroSlideAssetIds,
  MediaAssetInUseError,
  saveMediaAsset,
  type StorageDeps,
} from "@/lib/media/store";
import { addProductImage, createProduct } from "@/lib/catalog/products";
import { findAnyAdminId } from "../../../tests/helpers/admin-user";

/**
 * F-064/F-356/F-361 (release-hardening media-storage-integrity): a slot
 * "replace" used to delete the previously slotted asset's R2 object and DB
 * row *before* the new file was even decoded — a corrupt upload, or a
 * storage failure, permanently emptied the slot and cascade-deleted every
 * ProductImage/Category/hero-slide that reused the old asset from the
 * Media Library. These tests exercise `saveMediaAsset` directly, against
 * real Postgres (never SUPABASE_DATABASE_URL — see the isolated test DB
 * helper this package's tests run through) but an injected in-memory fake
 * for R2, so no real network call ever leaves this process.
 */

function makeFakeStorage(overrides: Partial<StorageDeps> = {}): StorageDeps {
  const store = new Map<string, Buffer>();
  return {
    isConfigured: () => true,
    upload: async (key, body) => {
      store.set(key, body);
    },
    publicUrl: (key) => `https://fake-r2.test/${key}`,
    ...overrides,
  };
}

async function tinyPngBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 24, height: 24, channels: 3, background: { r: 5, g: 6, b: 7 } } }).png().toBuffer();
}

const createdAssetIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];

after(async () => {
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
  }
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
  if (createdAssetIds.length > 0) {
    await db.mediaAsset.deleteMany({ where: { id: { in: createdAssetIds } } }).catch(() => {});
  }
});

describe("saveMediaAsset — slot replace never orphans/deletes the previous asset (F-064/F-356/F-361)", () => {
  it("a corrupt/unreadable upload leaves the previously-slotted asset's row and slot completely untouched", async () => {
    const slot = `test.store-guard.${randomUUID()}`;
    const storage = makeFakeStorage();

    const original = await saveMediaAsset({ buffer: await tinyPngBuffer(), usage: "SECTION", source: MediaSource.UPLOAD, slot }, storage);
    createdAssetIds.push(original.id);

    await assert.rejects(() =>
      saveMediaAsset({ buffer: Buffer.from("this is not an image"), usage: "SECTION", source: MediaSource.UPLOAD, slot }, storage),
    );

    const row = await db.mediaAsset.findUnique({ where: { id: original.id } });
    assert.ok(row, "the original row must survive a failed replace");
    assert.equal(row?.slot, slot, "the slot must still point at the original asset");

    const stillHoldsSlot = await db.mediaAsset.findUnique({ where: { slot } });
    assert.equal(stillHoldsSlot?.id, original.id);
  });

  it("a storage (R2) upload failure leaves the previously-slotted asset's row and slot completely untouched", async () => {
    const slot = `test.store-guard.${randomUUID()}`;
    const storage = makeFakeStorage();

    const original = await saveMediaAsset({ buffer: await tinyPngBuffer(), usage: "SECTION", source: MediaSource.UPLOAD, slot }, storage);
    createdAssetIds.push(original.id);

    const failingStorage = makeFakeStorage({
      upload: async () => {
        throw new Error("simulated transient R2 failure");
      },
    });

    const replacementBuffer = await tinyPngBuffer();
    await assert.rejects(() =>
      saveMediaAsset({ buffer: replacementBuffer, usage: "SECTION", source: MediaSource.UPLOAD, slot }, failingStorage),
    );

    const row = await db.mediaAsset.findUnique({ where: { id: original.id } });
    assert.ok(row, "the original row must survive a failed replace");
    assert.equal(row?.slot, slot);
  });

  it("a successful replace frees the old row's slot instead of deleting it, keeping its existing ProductImage reference intact", async () => {
    const unique = randomUUID().slice(0, 8);
    const slot = `test.store-guard.${unique}`;
    const storage = makeFakeStorage();
    const adminId = await findAnyAdminId();

    const original = await saveMediaAsset({ buffer: await tinyPngBuffer(), usage: "SECTION", source: MediaSource.UPLOAD, slot }, storage);
    createdAssetIds.push(original.id);

    // Reused from the Media Library onto a product gallery (F-356) — the
    // exact scenario a bare delete used to cascade away.
    const category = await db.category.create({
      data: { name: `Store Guard Category ${unique}`, slug: `store-guard-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct({ name: `Store Guard Product ${unique}`, categoryId: category.id, price: 500 }, adminId);
    createdProductIds.push(product.id);
    await addProductImage(product.id, original.id, {}, adminId);

    const replacement = await saveMediaAsset({ buffer: await tinyPngBuffer(), usage: "SECTION", source: MediaSource.UPLOAD, slot }, storage);
    createdAssetIds.push(replacement.id);

    assert.notEqual(replacement.id, original.id, "the replace must create a new row, not reuse the old one");
    assert.equal(replacement.slot, slot, "the new row now holds the slot");

    const originalRow = await db.mediaAsset.findUnique({
      where: { id: original.id },
      include: { productImages: true },
    });
    assert.ok(originalRow, "the old row must survive a successful replace, not be deleted");
    assert.equal(originalRow?.slot, null, "the old row's slot must be freed, not left dangling on a deleted row");
    assert.equal(originalRow?.productImages.length, 1, "the product's ProductImage row must survive — F-356's cascade-delete bug");
    assert.equal(originalRow?.productImages[0]?.mediaId, original.id);

    // The freed-up row is exactly what deleteUnattachedMediaAsset/
    // cleanup-orphaned-media.ts reclaim later — but only once nothing
    // references it any more; it's still attached here.
    await assert.rejects(() => deleteUnattachedMediaAsset(original.id, storage));
  });

  it("a successful replace keeps a hero-slide-referenced old asset alive (still freed, not deleted)", async () => {
    const unique = randomUUID().slice(0, 8);
    const slot = `test.store-guard.${unique}`;
    const storage = makeFakeStorage();

    const original = await saveMediaAsset({ buffer: await tinyPngBuffer(), usage: "SECTION", source: MediaSource.UPLOAD, slot }, storage);
    createdAssetIds.push(original.id);

    const existingSection = await db.homepageSection.findUnique({ where: { key: "hero-slides" } });
    const testContent = JSON.stringify({
      slides: [
        {
          id: "store-test-slide",
          enabled: true,
          eyebrow: "Test",
          headline: "Test Headline",
          subheadline: "Test Subheadline",
          description: "Test description.",
          primaryCta: { label: "Shop", href: "/shop" },
          secondaryCta: { label: "Learn more", href: "/for-hospitals" },
          image: { assetId: original.id, url: original.url, alt: "" },
          secondaryImage: null,
        },
      ],
      autoAdvanceMs: 6000,
    });

    if (existingSection) {
      await db.homepageSection.update({ where: { key: "hero-slides" }, data: { content: testContent } });
    } else {
      await db.homepageSection.create({ data: { key: "hero-slides", title: "Hero Carousel Slides", content: testContent } });
    }

    try {
      const replacement = await saveMediaAsset({ buffer: await tinyPngBuffer(), usage: "SECTION", source: MediaSource.UPLOAD, slot }, storage);
      createdAssetIds.push(replacement.id);

      const heroIds = await getHeroSlideAssetIds();
      assert.ok(heroIds.has(original.id), "the hero slide still snapshots the old asset id");

      await assert.rejects(() => deleteUnattachedMediaAsset(original.id, storage), MediaAssetInUseError);
    } finally {
      if (existingSection) {
        await db.homepageSection.update({
          where: { key: "hero-slides" },
          data: { content: existingSection.content, enabled: existingSection.enabled },
        });
      } else {
        await db.homepageSection.delete({ where: { key: "hero-slides" } }).catch(() => {});
      }
    }
  });
});

describe("deleteUnattachedMediaAsset — refuses to delete a non-REJECTED review's photo (F-357)", () => {
  const createdReviewIds: string[] = [];
  const createdCustomerIds: string[] = [];

  after(async () => {
    if (createdReviewIds.length > 0) {
      await db.review.deleteMany({ where: { id: { in: createdReviewIds } } }).catch(() => {});
    }
    if (createdCustomerIds.length > 0) {
      await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
    }
  });

  it("refuses to delete an APPROVED review's photo, and never calls remove()", async () => {
    const unique = randomUUID().slice(0, 8);
    let removeCalls = 0;
    const storage = makeFakeStorage({ remove: async () => { removeCalls += 1; } });
    const adminId = await findAnyAdminId();

    const category = await db.category.create({
      data: { name: `Store Review Guard Category ${unique}`, slug: `store-review-guard-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);
    const product = await createProduct({ name: `Store Review Guard Product ${unique}`, categoryId: category.id, price: 500 }, adminId);
    createdProductIds.push(product.id);
    const customer = await db.customer.create({
      data: { email: `store-review-guard-${unique}@example.com`, name: "Test Reviewer", passwordHash: "x" },
    });
    createdCustomerIds.push(customer.id);

    const photo = await saveMediaAsset({ buffer: await tinyPngBuffer(), usage: "REVIEW", source: MediaSource.UPLOAD }, storage);
    createdAssetIds.push(photo.id);

    const review = await db.review.create({
      data: { productId: product.id, customerId: customer.id, rating: 5, body: "Nice.", status: "APPROVED", photoIds: [photo.id] },
    });
    createdReviewIds.push(review.id);

    await assert.rejects(() => deleteUnattachedMediaAsset(photo.id, storage), MediaAssetInUseError);
    assert.equal(removeCalls, 0, "must refuse before ever touching storage");
    assert.ok(await db.mediaAsset.findUnique({ where: { id: photo.id } }), "the row must survive the refused delete");
  });
});
