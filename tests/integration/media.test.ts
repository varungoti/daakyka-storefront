import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { MediaSource } from "@/generated/prisma/client";
import {
  deleteUnattachedMediaAsset,
  MediaAssetAttachedError,
  MediaAssetInUseError,
  MediaAssetNotFoundError,
  saveMediaAsset,
  StorageNotConfiguredForMediaError,
  type StorageDeps,
} from "@/lib/media/store";
import { addProductImage, createProduct } from "@/lib/catalog/products";
import { isR2Configured } from "@/lib/storage/r2";
import { DELETE as deleteMediaAsset } from "@/app/api/admin/media/[id]/route";
import {
  countAiImagesGeneratedToday,
  DailyLimitReachedError,
  generateImage,
  GenerationFailedError,
  ImageGenerationNotConfiguredError,
  isImageGenerationConfigured,
  SlotNotAiGeneratableError,
  type OpenAIImageClient,
} from "@/lib/ai/image-generation";
import { POST as postMediaUpload } from "@/app/api/admin/media/route";
import { POST as postMediaGenerate } from "@/app/api/admin/media/generate/route";
import { withEnv } from "../helpers/env";
import { findAnyAdminId } from "../helpers/admin-user";

/** An in-memory fake storage backend — no network call ever leaves this process. */
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

function makeFakeOpenAIClient(b64: string): OpenAIImageClient {
  return {
    images: {
      generate: async () => ({ data: [{ b64_json: b64 }] }),
    },
  };
}

async function tinyPngBuffer(): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

const createdAssetIds: string[] = [];

after(async () => {
  if (createdAssetIds.length > 0) {
    await db.mediaAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
  }
});

describe("saveMediaAsset (integration, fake storage — no real R2 call)", () => {
  it("processes the buffer, 'uploads' via the injected fake, and creates a MediaAsset row", async () => {
    const buffer = await tinyPngBuffer();
    const adminId = await findAnyAdminId();

    const asset = await saveMediaAsset(
      {
        buffer,
        usage: "PRODUCT",
        source: MediaSource.UPLOAD,
        alt: "Test product photo",
        createdById: adminId,
      },
      makeFakeStorage(),
    );
    createdAssetIds.push(asset.id);

    assert.ok(asset.id);
    assert.equal(asset.usage, "PRODUCT");
    assert.equal(asset.source, "UPLOAD");
    assert.equal(asset.url, `https://fake-r2.test/${asset.key}`);
    assert.match(asset.key, /^media\/product\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/);
    assert.ok(asset.width && asset.width > 0);

    const row = await db.mediaAsset.findUnique({ where: { id: asset.id } });
    assert.ok(row);
    assert.equal(row?.alt, "Test product photo");
  });

  it("throws StorageNotConfiguredForMediaError — the exact error the upload route maps to 503 — when storage isn't configured", async () => {
    const buffer = await tinyPngBuffer();
    await assert.rejects(
      () =>
        saveMediaAsset(
          { buffer, usage: "CATEGORY", source: MediaSource.UPLOAD },
          makeFakeStorage({ isConfigured: () => false }),
        ),
      StorageNotConfiguredForMediaError,
    );
  });
});

describe("generateImage (integration, fake OpenAI client + fake storage — no real network call)", () => {
  it("throws ImageGenerationNotConfiguredError — the exact error the generate route maps to 503 — when OPENAI_API_KEY is unset", async () => {
    await withEnv({ OPENAI_API_KEY: undefined }, async () => {
      await assert.rejects(
        () =>
          generateImage(
            { preset: "product", aspect: "square", usage: "PRODUCT" },
            { client: makeFakeOpenAIClient("not-used"), storage: makeFakeStorage() },
          ),
        ImageGenerationNotConfiguredError,
      );
    });
  });

  it("decodes a fake base64 PNG and creates an AI MediaAsset with the built prompt and model recorded", async () => {
    const adminId = await findAnyAdminId();
    const pngB64 = (await tinyPngBuffer()).toString("base64");

    await withEnv({ OPENAI_API_KEY: "test-key-not-real", AI_IMAGE_DAILY_LIMIT: "999999" }, async () => {
      const asset = await generateImage(
        {
          preset: "product",
          fields: { name: "Test Scrub", color: "plum" },
          aspect: "square",
          usage: "PRODUCT",
          createdById: adminId,
        },
        { client: makeFakeOpenAIClient(pngB64), storage: makeFakeStorage() },
      );
      createdAssetIds.push(asset.id);

      assert.equal(asset.source, "AI");
      assert.ok(asset.prompt?.includes("Test Scrub"));
      assert.ok(asset.model);
    });
  });

  it("throws GenerationFailedError when the client returns no image data", async () => {
    await withEnv({ OPENAI_API_KEY: "test-key-not-real", AI_IMAGE_DAILY_LIMIT: "999999" }, async () => {
      await assert.rejects(
        () =>
          generateImage(
            { preset: "avatar", aspect: "square", usage: "AVATAR" },
            {
              client: { images: { generate: async () => ({ data: [] }) } },
              storage: makeFakeStorage(),
            },
          ),
        GenerationFailedError,
      );
    });
  });

  it("wraps a thrown client error as GenerationFailedError", async () => {
    await withEnv({ OPENAI_API_KEY: "test-key-not-real", AI_IMAGE_DAILY_LIMIT: "999999" }, async () => {
      await assert.rejects(
        () =>
          generateImage(
            { preset: "avatar", aspect: "square", usage: "AVATAR" },
            {
              client: {
                images: {
                  generate: async () => {
                    throw new Error("simulated upstream failure");
                  },
                },
              },
              storage: makeFakeStorage(),
            },
          ),
        GenerationFailedError,
      );
    });
  });

  it("refuses to generate for an uploadOnly slot (real founder portrait / client logo) before ever calling the client", async () => {
    await withEnv({ OPENAI_API_KEY: "test-key-not-real", AI_IMAGE_DAILY_LIMIT: "999999" }, async () => {
      let generateCalls = 0;
      const countingClient: OpenAIImageClient = {
        images: {
          generate: async () => {
            generateCalls += 1;
            return { data: [{ b64_json: "unused" }] };
          },
        },
      };

      await assert.rejects(
        () =>
          generateImage(
            {
              preset: "avatar",
              aspect: "portrait",
              usage: "AVATAR",
              slot: "about.founder.kamal",
            },
            { client: countingClient, storage: makeFakeStorage() },
          ),
        SlotNotAiGeneratableError,
      );
      assert.equal(generateCalls, 0, "the client must not be called for an uploadOnly slot");
    });
  });

  it("enforces AI_IMAGE_DAILY_LIMIT before ever calling the client", async () => {
    const adminId = await findAnyAdminId();
    const before = await countAiImagesGeneratedToday();
    const limit = before + 1; // Exactly one more generation is allowed before the cap trips.

    await withEnv(
      { OPENAI_API_KEY: "test-key-not-real", AI_IMAGE_DAILY_LIMIT: String(limit) },
      async () => {
        const pngB64 = (await tinyPngBuffer()).toString("base64");
        let generateCalls = 0;
        const countingClient: OpenAIImageClient = {
          images: {
            generate: async () => {
              generateCalls += 1;
              return { data: [{ b64_json: pngB64 }] };
            },
          },
        };

        const asset = await generateImage(
          { preset: "avatar", aspect: "square", usage: "AVATAR", createdById: adminId },
          { client: countingClient, storage: makeFakeStorage() },
        );
        createdAssetIds.push(asset.id);
        assert.equal(generateCalls, 1);

        await assert.rejects(
          () =>
            generateImage(
              { preset: "avatar", aspect: "square", usage: "AVATAR", createdById: adminId },
              { client: countingClient, storage: makeFakeStorage() },
            ),
          DailyLimitReachedError,
        );
        assert.equal(generateCalls, 1, "the client must not be called once the cap is reached");
      },
    );
  });
});

describe("deleteUnattachedMediaAsset (F-04 orphan cleanup — docs/audit-2026-09-19/admin-ux.md)", () => {
  const createdCategoryIds: string[] = [];
  const createdProductIds: string[] = [];

  after(async () => {
    if (createdProductIds.length > 0) {
      await db.product.deleteMany({ where: { id: { in: createdProductIds } } });
    }
    if (createdCategoryIds.length > 0) {
      await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
    }
  });

  it("deletes the R2 object (via the injected fake) and the MediaAsset row when nothing references it", async () => {
    const buffer = await tinyPngBuffer();
    const removedKeys: string[] = [];
    const storage = makeFakeStorage({ remove: async (key) => { removedKeys.push(key); } });

    const asset = await saveMediaAsset({ buffer, usage: "PRODUCT", source: MediaSource.UPLOAD }, storage);

    await deleteUnattachedMediaAsset(asset.id, storage);

    assert.deepEqual(removedKeys, [asset.key]);
    assert.equal(await db.mediaAsset.findUnique({ where: { id: asset.id } }), null);
  });

  it("still deletes the DB row when the storage backend has no remove() (defaults gracefully)", async () => {
    const buffer = await tinyPngBuffer();
    // makeFakeStorage() doesn't set `remove` unless overridden — exercises
    // the `storage.remove &&` guard in deleteUnattachedMediaAsset.
    const storage = makeFakeStorage();

    const asset = await saveMediaAsset({ buffer, usage: "PRODUCT", source: MediaSource.UPLOAD }, storage);
    await deleteUnattachedMediaAsset(asset.id, storage);

    assert.equal(await db.mediaAsset.findUnique({ where: { id: asset.id } }), null);
  });

  it("still deletes the DB row when the injected remove() throws (best-effort R2 cleanup, matching saveMediaAsset's own slot-replacement tradeoff)", async () => {
    const buffer = await tinyPngBuffer();
    const storage = makeFakeStorage({
      remove: async () => {
        throw new Error("simulated transient R2 failure");
      },
    });

    const asset = await saveMediaAsset({ buffer, usage: "PRODUCT", source: MediaSource.UPLOAD }, storage);
    await deleteUnattachedMediaAsset(asset.id, storage);

    assert.equal(await db.mediaAsset.findUnique({ where: { id: asset.id } }), null);
  });

  it("throws MediaAssetNotFoundError for an id that doesn't exist", async () => {
    await assert.rejects(() => deleteUnattachedMediaAsset(`missing-${randomUUID()}`, makeFakeStorage()), MediaAssetNotFoundError);
  });

  it("refuses to delete an asset already attached to a product (ProductImage row exists), and never calls remove()", async () => {
    const unique = randomUUID().slice(0, 8);
    let removeCalls = 0;
    const storage = makeFakeStorage({ remove: async () => { removeCalls += 1; } });

    const category = await db.category.create({
      data: { name: `Media Delete Test Category ${unique}`, slug: `media-delete-test-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);

    const adminId = await findAnyAdminId();
    const product = await createProduct({ name: `Media Delete Test Product ${unique}`, categoryId: category.id, price: 500 }, adminId);
    createdProductIds.push(product.id);

    const buffer = await tinyPngBuffer();
    const asset = await saveMediaAsset({ buffer, usage: "PRODUCT", source: MediaSource.UPLOAD }, storage);
    await addProductImage(product.id, asset.id, {}, adminId);

    await assert.rejects(() => deleteUnattachedMediaAsset(asset.id, storage), MediaAssetAttachedError);
    assert.equal(removeCalls, 0, "must refuse before ever touching storage");
    assert.ok(await db.mediaAsset.findUnique({ where: { id: asset.id } }), "the row must survive the refused delete");

    // Cleanup: the product's own cascade (ProductImage.onDelete: Cascade)
    // handles the ProductImage row when createdProductIds is torn down
    // above; the MediaAsset row still needs its own cleanup since deleting
    // it isn't what this test is exercising.
    await db.mediaAsset.delete({ where: { id: asset.id } }).catch(() => {});
  });

  it("refuses to delete a manifest-slotted asset, and never calls remove()", async () => {
    let removeCalls = 0;
    const storage = makeFakeStorage({ remove: async () => { removeCalls += 1; } });
    const buffer = await tinyPngBuffer();

    const asset = await saveMediaAsset(
      { buffer, usage: "SECTION", source: MediaSource.UPLOAD, slot: `test.delete-guard.${randomUUID()}` },
      storage,
    );

    await assert.rejects(() => deleteUnattachedMediaAsset(asset.id, storage), MediaAssetInUseError);
    assert.equal(removeCalls, 0);

    await db.mediaAsset.delete({ where: { id: asset.id } }).catch(() => {});
  });

  it("refuses to delete an asset used as a Category's image, and never calls remove()", async () => {
    const unique = randomUUID().slice(0, 8);
    let removeCalls = 0;
    const storage = makeFakeStorage({ remove: async () => { removeCalls += 1; } });
    const buffer = await tinyPngBuffer();

    const asset = await saveMediaAsset({ buffer, usage: "CATEGORY", source: MediaSource.UPLOAD }, storage);
    const category = await db.category.create({
      data: {
        name: `Media Delete Test Category Image ${unique}`,
        slug: `media-delete-test-category-image-${unique}`,
        section: "GENERAL",
        imageId: asset.id,
      },
    });
    createdCategoryIds.push(category.id);

    await assert.rejects(() => deleteUnattachedMediaAsset(asset.id, storage), MediaAssetInUseError);
    assert.equal(removeCalls, 0);

    // Clear the category's imageId before the MediaAsset can be deleted for
    // real (the relation is onDelete: SetNull, but this test wants a clean,
    // explicit teardown rather than relying on that).
    await db.category.update({ where: { id: category.id }, data: { imageId: null } });
    await db.mediaAsset.delete({ where: { id: asset.id } }).catch(() => {});
  });

  it("refuses to delete an asset referenced by a hero carousel slide, and never calls remove()", async () => {
    let removeCalls = 0;
    const storage = makeFakeStorage({ remove: async () => { removeCalls += 1; } });
    const buffer = await tinyPngBuffer();

    const asset = await saveMediaAsset({ buffer, usage: "BANNER", source: MediaSource.UPLOAD }, storage);
    createdAssetIds.push(asset.id);

    // Save/restore whatever "hero-slides" content already exists (real
    // seeded slides, in a seeded DB) — mirrors
    // tests/integration/homepage-cache.test.ts's save/restore dance for
    // "trust-stats", so this test never permanently clobbers real content.
    const existing = await db.homepageSection.findUnique({ where: { key: "hero-slides" } });
    const testContent = JSON.stringify({
      slides: [
        {
          id: "test-slide",
          enabled: true,
          eyebrow: "Test",
          headline: "Test Headline",
          subheadline: "Test Subheadline",
          description: "Test description.",
          primaryCta: { label: "Shop", href: "/shop" },
          secondaryCta: { label: "Learn more", href: "/for-hospitals" },
          image: { assetId: asset.id, url: asset.url, alt: "" },
          secondaryImage: null,
        },
      ],
      autoAdvanceMs: 6000,
    });

    if (existing) {
      await db.homepageSection.update({ where: { key: "hero-slides" }, data: { content: testContent } });
    } else {
      await db.homepageSection.create({
        data: { key: "hero-slides", title: "Hero Carousel Slides", content: testContent },
      });
    }

    try {
      await assert.rejects(() => deleteUnattachedMediaAsset(asset.id, storage), MediaAssetInUseError);
      assert.equal(removeCalls, 0);
      assert.ok(await db.mediaAsset.findUnique({ where: { id: asset.id } }), "the row must survive the refused delete");
    } finally {
      if (existing) {
        await db.homepageSection.update({
          where: { key: "hero-slides" },
          data: { content: existing.content, enabled: existing.enabled },
        });
      } else {
        await db.homepageSection.delete({ where: { key: "hero-slides" } }).catch(() => {});
      }
    }
  });

  it("DELETE /api/admin/media/[id] rejects with 401/403 before any lookup", async () => {
    const request = new Request("http://localhost/api/admin/media/some-id", { method: "DELETE" });
    const response = await deleteMediaAsset(request, { params: Promise.resolve({ id: "some-id" }) });
    assert.ok(response.status === 401 || response.status === 403, `expected 401 or 403, got ${response.status}`);
  });
});

describe("real (uninjected) configuration checks — this environment has no real credentials", () => {
  it("isR2Configured() is false without R2 env vars — this is what the routes report as 503", async () => {
    await withEnv(
      {
        R2_ACCOUNT_ID: undefined,
        R2_ACCESS_KEY_ID: undefined,
        R2_SECRET_ACCESS_KEY: undefined,
        R2_BUCKET: undefined,
      },
      () => {
        assert.equal(isR2Configured(), false);
      },
    );
  });

  it("isImageGenerationConfigured() is false without OPENAI_API_KEY — this is what the route reports as 503", async () => {
    await withEnv({ OPENAI_API_KEY: undefined }, () => {
      assert.equal(isImageGenerationConfigured(), false);
    });
  });
});

// requireAdminPermission() calls getSession(), which reads the session
// cookie via next/headers' cookies() — that throws outside a real Next.js
// request scope and is caught to return null, so every route handler
// invoked directly here (no way to fabricate an authenticated Next
// request in this test harness — same constraint the rest of this repo's
// route-handler integration tests work under, e.g.
// tests/integration/site-settings.test.ts) always sees "no session" and
// returns 401/403 before reaching content-type, body, or configuration
// checks. The "not configured -> 503" mapping itself is covered directly
// above, against the exact error types each route's catch block checks
// for.
describe("admin media routes without a session", () => {
  it("POST /api/admin/media rejects with 401/403 before any content-type or config check", async () => {
    const request = new Request("http://localhost/api/admin/media", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=x" },
      body: "--x--",
    });
    const response = await postMediaUpload(request);
    assert.ok(
      response.status === 401 || response.status === 403,
      `expected 401 or 403, got ${response.status}`,
    );
  });

  it("POST /api/admin/media/generate rejects with 401/403 before any body validation", async () => {
    const request = new Request("http://localhost/api/admin/media/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset: "product", aspect: "square", usage: "PRODUCT" }),
    });
    const response = await postMediaGenerate(request);
    assert.ok(
      response.status === 401 || response.status === 403,
      `expected 401 or 403, got ${response.status}`,
    );
  });
});
