import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "@/lib/db";
import { deleteUnattachedMediaAsset, saveMediaAsset, type StorageDeps } from "@/lib/media/store";
import { countAiImagesGeneratedToday, generateImage, type OpenAIImageClient } from "@/lib/ai/image-generation";
import { findAnyAdminId } from "../../../tests/helpers/admin-user";
import { withEnv } from "../../../tests/helpers/env";

/**
 * F-188 fix (release-hardening schema-foundation): the daily AI-image cap
 * used to count surviving `MediaAsset` rows with source=AI, so regenerating
 * the same slot (which deletes the previous asset — see saveMediaAsset in
 * src/lib/media/store.ts) or removing a staged image
 * (deleteUnattachedMediaAsset) silently lowered the count, letting an
 * admin generate far more than the daily limit's worth of paid OpenAI
 * calls. countAiImagesGeneratedToday now counts append-only
 * `AiImageGenerationEvent` rows instead — see its doc comment.
 *
 * Same in-memory-fake-storage / fake-OpenAI-client approach as
 * tests/integration/media.test.ts, wrapped in withEnv({OPENAI_API_KEY})
 * because testdb.mjs blanks that var (it points at the real OpenAI API,
 * never used here — the client is always the injected fake).
 */

function makeFakeStorage(): StorageDeps {
  const store = new Map<string, Buffer>();
  return {
    isConfigured: () => true,
    upload: async (key, body) => {
      store.set(key, body);
    },
    publicUrl: (key) => `https://fake-r2.test/${key}`,
  };
}

function makeFakeOpenAIClient(b64: string): OpenAIImageClient {
  return {
    images: {
      generate: async () => ({ data: [{ b64_json: b64 }] }),
    },
  };
}

async function tinyPngBase64(): Promise<string> {
  const buffer = await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 5, g: 15, b: 25 } },
  })
    .png()
    .toBuffer();
  return buffer.toString("base64");
}

const createdAssetIds: string[] = [];
const createdEventIds: string[] = [];

after(async () => {
  if (createdAssetIds.length > 0) {
    await db.mediaAsset.deleteMany({ where: { id: { in: createdAssetIds } } }).catch(() => {});
  }
  if (createdEventIds.length > 0) {
    await db.aiImageGenerationEvent.deleteMany({ where: { id: { in: createdEventIds } } }).catch(() => {});
  }
});

/** Records every AiImageGenerationEvent created during `fn` (by id, via a
 * before/after diff) so assertions and cleanup are scoped to this test's
 * own writes on a table shared with the rest of the concurrently-running
 * integration suite. */
async function trackNewEvents<T>(fn: () => Promise<T>): Promise<T> {
  const before = new Set((await db.aiImageGenerationEvent.findMany({ select: { id: true } })).map((e) => e.id));
  const result = await fn();
  const rows = await db.aiImageGenerationEvent.findMany({ select: { id: true } });
  for (const { id } of rows) {
    if (!before.has(id)) createdEventIds.push(id);
  }
  return result;
}

describe("AI image generation cap counts events, not surviving assets (F-188)", () => {
  it("countAiImagesGeneratedToday counts AiImageGenerationEvent rows, not MediaAsset rows", async () => {
    const adminId = await findAnyAdminId();
    const before = await countAiImagesGeneratedToday();

    await withEnv({ OPENAI_API_KEY: "test-key-not-real" }, () =>
      trackNewEvents(async () => {
        const asset = await generateImage(
          { preset: "avatar", aspect: "square", usage: "AVATAR", createdById: adminId },
          { client: makeFakeOpenAIClient(await tinyPngBase64()), storage: makeFakeStorage() },
        );
        createdAssetIds.push(asset.id);
      }),
    );

    assert.equal(await countAiImagesGeneratedToday(), before + 1);
  });

  it("regenerating the same slot does not lower the count, even though the old MediaAsset row is deleted", async () => {
    const adminId = await findAnyAdminId();
    const slot = `test.schema-foundation.${randomUUID().slice(0, 8)}`;

    await withEnv({ OPENAI_API_KEY: "test-key-not-real" }, () =>
      trackNewEvents(async () => {
        const first = await generateImage(
          { preset: "avatar", aspect: "square", usage: "AVATAR", slot, createdById: adminId },
          { client: makeFakeOpenAIClient(await tinyPngBase64()), storage: makeFakeStorage() },
        );
        createdAssetIds.push(first.id);

        const before = await countAiImagesGeneratedToday();

        // Regenerating the same slot deletes `first`'s MediaAsset row (see
        // saveMediaAsset) — the old counting-MediaAsset-rows implementation
        // would have this generation net to the *same* count as before it,
        // instead of +1.
        const second = await generateImage(
          { preset: "avatar", aspect: "square", usage: "AVATAR", slot, createdById: adminId },
          { client: makeFakeOpenAIClient(await tinyPngBase64()), storage: makeFakeStorage() },
        );
        createdAssetIds.push(second.id);
        assert.notEqual(second.id, first.id, "regenerating should have replaced the row, not reused it");

        assert.equal(await countAiImagesGeneratedToday(), before + 1);
      }),
    );
  });

  it("removing a staged (unattached) generated image does not lower the count", async () => {
    const adminId = await findAnyAdminId();

    await withEnv({ OPENAI_API_KEY: "test-key-not-real" }, () =>
      trackNewEvents(async () => {
        const asset = await generateImage(
          { preset: "avatar", aspect: "square", usage: "AVATAR", createdById: adminId },
          { client: makeFakeOpenAIClient(await tinyPngBase64()), storage: makeFakeStorage() },
        );

        const before = await countAiImagesGeneratedToday();
        await deleteUnattachedMediaAsset(asset.id, makeFakeStorage());
        assert.equal(
          await countAiImagesGeneratedToday(),
          before,
          "deleting the asset must not decrement the daily count",
        );
      }),
    );
  });

  it("saveMediaAsset (a plain upload, not generateImage) never writes an AiImageGenerationEvent", async () => {
    const before = await countAiImagesGeneratedToday();
    const buffer = Buffer.from(await tinyPngBase64(), "base64");
    const asset = await saveMediaAsset({ buffer, usage: "PRODUCT", source: "UPLOAD" }, makeFakeStorage());
    createdAssetIds.push(asset.id);

    assert.equal(
      await countAiImagesGeneratedToday(),
      before,
      "an UPLOAD-sourced asset must never count toward the AI cap",
    );
  });
});
