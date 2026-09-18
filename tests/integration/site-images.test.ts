import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { categoryImageSlot } from "@/data/media/image-manifest";
import { getSiteImage, getSiteImages, MEDIA_CACHE_TAG } from "@/lib/media/get-site-image";

/**
 * Phase E2 integration tests for the read side of the image manifest.
 * Requires a running Postgres (storefront-postgres-1) — same DB the rest
 * of this repo's integration suite uses. Every row this file creates is
 * cleaned up in `after()` so the shared dev DB is left exactly as found.
 */

const createdAssetIds: string[] = [];

after(async () => {
  if (createdAssetIds.length > 0) {
    await db.mediaAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
  }
});

describe("getSiteImage", () => {
  it("exports the 'media' cache tag used to invalidate every slot on write", () => {
    assert.equal(MEDIA_CACHE_TAG, "media");
  });

  it("returns null for a slot with no MediaAsset row", async () => {
    const result = await getSiteImage(`e2-test.unconfigured.${randomUUID()}`);
    assert.equal(result, null);
  });

  it("returns the matching asset's url/alt once a MediaAsset exists for the slot", async () => {
    const slot = `e2-test.slot.${randomUUID()}`;
    const asset = await db.mediaAsset.create({
      data: {
        key: `media/section/test/${randomUUID()}.webp`,
        url: "https://fake-r2.test/example.webp",
        alt: "A test site image",
        usage: "SECTION",
        source: "UPLOAD",
        slot,
      },
    });
    createdAssetIds.push(asset.id);

    const result = await getSiteImage(slot);
    assert.deepEqual(result, { url: asset.url, alt: asset.alt });
  });

  it("falls back to an empty alt string when the asset has none", async () => {
    const slot = `e2-test.no-alt.${randomUUID()}`;
    const asset = await db.mediaAsset.create({
      data: {
        key: `media/section/test/${randomUUID()}.webp`,
        url: "https://fake-r2.test/no-alt.webp",
        usage: "BANNER",
        source: "UPLOAD",
        slot,
      },
    });
    createdAssetIds.push(asset.id);

    const result = await getSiteImage(slot);
    assert.deepEqual(result, { url: asset.url, alt: "" });
  });

  it("getSiteImages resolves several slots in one call, missing ones as null", async () => {
    const slot = `e2-test.batch.${randomUUID()}`;
    const missingSlot = `e2-test.batch-missing.${randomUUID()}`;
    const asset = await db.mediaAsset.create({
      data: {
        key: `media/section/test/${randomUUID()}.webp`,
        url: "https://fake-r2.test/batch.webp",
        alt: "Batch test image",
        usage: "SECTION",
        source: "UPLOAD",
        slot,
      },
    });
    createdAssetIds.push(asset.id);

    const results = await getSiteImages([slot, missingSlot]);
    assert.deepEqual(results[slot], { url: asset.url, alt: asset.alt });
    assert.equal(results[missingSlot], null);
  });
});

describe("dynamic category.{slug} slot", () => {
  it("resolves once a MediaAsset is created for a real seeded category's slot", async () => {
    const category = await db.category.findFirst({ where: { active: true } });
    assert.ok(category, "expected at least one active Category to exist for this test");

    const entry = categoryImageSlot(category);
    assert.equal(entry.slot, `category.${category.slug}`);

    // The slot may already be unused (no MediaAsset yet, the real E2
    // state) — assert null first, then create one and confirm it
    // resolves, cleaning up afterwards either way.
    const before = await getSiteImage(entry.slot);
    if (before !== null) {
      // Some earlier, unrelated run left a real asset for this category —
      // don't touch it; just confirm the lookup at least returns
      // something shaped like a SiteImage instead of throwing.
      assert.ok(typeof before.url === "string" && before.url.length > 0);
      return;
    }

    const asset = await db.mediaAsset.create({
      data: {
        key: `media/category/test/${randomUUID()}.webp`,
        url: "https://fake-r2.test/category.webp",
        alt: `${category.name} category tile`,
        usage: "CATEGORY",
        source: "UPLOAD",
        slot: entry.slot,
      },
    });
    createdAssetIds.push(asset.id);

    const result = await getSiteImage(entry.slot);
    assert.deepEqual(result, { url: asset.url, alt: asset.alt });
  });
});
