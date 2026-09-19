import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { PrismaClient } from "@/generated/prisma/client";
import { MediaSource } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addProductImage, createProduct } from "@/lib/catalog/products";
import { saveMediaAsset, type StorageDeps } from "@/lib/media/store";
import {
  assertNotProductionDatabase,
  findOrphanedMediaCandidates,
  isProvablyOrphaned,
  parseCliArgs,
  runCli,
  type OrphanCandidate,
} from "./cleanup-orphaned-media";

/**
 * Release-hardening F-04 / plan item cleanup (docs/audit-2026-09-19/admin-ux.md):
 * tests for the orphaned-media sweep script — the backstop for a product
 * photo staged (uploaded/AI-generated) on the *new* product form and then
 * abandoned before the product was ever saved. Follows the exact test
 * pattern established by scripts/cleanup-phantom-customers.test.ts: DB
 * writes are real (against the local dev Postgres this test suite already
 * runs against — never SUPABASE_DATABASE_URL), but every query this script
 * issues is scoped to exactly the rows this test created via `scopedDb`, so
 * it can't be affected by — or affect — whatever else is happening
 * concurrently in the shared dev database.
 */

type Database = Pick<PrismaClient, "mediaAsset">;

function scopedDb(ids: string[]): Database {
  // AND-compose rather than spread-merge — see the identical comment in
  // cleanup-phantom-customers.test.ts's own scopedDb for why.
  return {
    mediaAsset: {
      findMany: ((args: Parameters<typeof db.mediaAsset.findMany>[0]) =>
        db.mediaAsset.findMany({ ...args, where: { AND: [args?.where ?? {}, { id: { in: ids } }] } })) as typeof db.mediaAsset.findMany,
    },
  } as Database;
}

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
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
}

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
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

/** Directly inserts a MediaAsset row with a specific `createdAt`, bypassing
 * saveMediaAsset() (which always stamps "now") — needed to simulate a row
 * that's genuinely past the grace period without waiting hours in a test. */
async function createAssetAt(createdAt: Date, overrides: Partial<{ slot: string }> = {}): Promise<string> {
  const buffer = await tinyPngBuffer();
  const storage = makeFakeStorage();
  const asset = await saveMediaAsset({ buffer, usage: "PRODUCT", source: MediaSource.UPLOAD, ...overrides }, storage);
  await db.mediaAsset.update({ where: { id: asset.id }, data: { createdAt } });
  createdAssetIds.push(asset.id);
  return asset.id;
}

function fakeCandidate(overrides: Partial<OrphanCandidate> = {}): OrphanCandidate {
  return {
    id: "m1",
    key: "media/product/2026/01/m1.webp",
    usage: "PRODUCT",
    source: "UPLOAD",
    createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000),
    slot: null,
    productImageCount: 0,
    categoryCount: 0,
    ...overrides,
  };
}

describe("isProvablyOrphaned (pure)", () => {
  it("is true for an unattached, un-slotted, un-categorized row past the grace period", () => {
    assert.equal(isProvablyOrphaned(fakeCandidate()), true);
  });

  it("is false when the row has a slot", () => {
    assert.equal(isProvablyOrphaned(fakeCandidate({ slot: "home.hero.1" })), false);
  });

  it("is false when the row is attached to a product", () => {
    assert.equal(isProvablyOrphaned(fakeCandidate({ productImageCount: 1 })), false);
  });

  it("is false when the row is used as a category image", () => {
    assert.equal(isProvablyOrphaned(fakeCandidate({ categoryCount: 1 })), false);
  });

  it("is false when the row is newer than the grace period", () => {
    assert.equal(isProvablyOrphaned(fakeCandidate({ createdAt: new Date() })), false);
  });

  it("respects a custom grace period", () => {
    const oneHourOld = fakeCandidate({ createdAt: new Date(Date.now() - 60 * 60 * 1000) });
    assert.equal(isProvablyOrphaned(oneHourOld, 48), false, "1h old must not clear a 48h grace period");
    assert.equal(isProvablyOrphaned(oneHourOld, 0), true, "1h old must clear a 0h grace period");
  });
});

describe("assertNotProductionDatabase (pure)", () => {
  it("throws when DATABASE_URL is unset", () => {
    assert.throws(() => assertNotProductionDatabase(undefined, undefined));
  });

  it("throws when DATABASE_URL equals SUPABASE_DATABASE_URL", () => {
    const url = "postgresql://user:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
    assert.throws(() => assertNotProductionDatabase(url, url));
  });

  it("throws when DATABASE_URL looks like a Supabase host, even if SUPABASE_DATABASE_URL is unset", () => {
    assert.throws(() => assertNotProductionDatabase("postgresql://postgres.xyz:pw@db.myproject.supabase.co:5432/postgres", undefined));
  });

  it("passes for a local Docker Postgres URL distinct from SUPABASE_DATABASE_URL", () => {
    assert.doesNotThrow(() =>
      assertNotProductionDatabase(
        "postgresql://daakyka:daakyka@localhost:5432/daakyka_dev",
        "postgresql://postgres.abc:pw@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres",
      ),
    );
  });
});

describe("parseCliArgs (pure)", () => {
  it("defaults to a dry run and the default 48h grace period", () => {
    const options = parseCliArgs([]);
    assert.equal(options.execute, false);
    assert.equal(options.graceHours, 48);
  });

  it("recognises --execute", () => {
    assert.equal(parseCliArgs(["--execute"]).execute, true);
  });

  it("recognises --older-than-hours=N", () => {
    assert.equal(parseCliArgs(["--older-than-hours=6"]).graceHours, 6);
  });

  it("falls back to the default for a malformed --older-than-hours", () => {
    assert.equal(parseCliArgs(["--older-than-hours=nope"]).graceHours, 48);
  });
});

describe("findOrphanedMediaCandidates + runCli (scoped to this test's own rows)", () => {
  it("selects an old, unattached, un-slotted asset but not a fresh one, a slotted one, or an attached one", async () => {
    const unique = randomUUID().slice(0, 8);
    const oldEnough = new Date(Date.now() - 72 * 60 * 60 * 1000);

    const orphan = await createAssetAt(oldEnough);
    const tooFresh = await createAssetAt(new Date());
    const slotted = await createAssetAt(oldEnough, { slot: `test.cleanup-guard.${unique}` });

    const category = await db.category.create({
      data: { name: `Cleanup Test Category ${unique}`, slug: `cleanup-test-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);
    const adminId = await findAnyAdminId();
    const product = await createProduct({ name: `Cleanup Test Product ${unique}`, categoryId: category.id, price: 500 }, adminId);
    createdProductIds.push(product.id);
    const attached = await createAssetAt(oldEnough);
    await addProductImage(product.id, attached, {}, adminId);

    const ids = [orphan, tooFresh, slotted, attached];
    const candidates = await findOrphanedMediaCandidates(scopedDb(ids));
    const candidateIds = candidates.map((c) => c.id);

    assert.ok(candidateIds.includes(orphan), "the old, unattached, un-slotted row should be a candidate");
    assert.ok(!candidateIds.includes(tooFresh), "a fresh row must never be a candidate regardless of attachment");
    assert.ok(!candidateIds.includes(slotted), "a manifest-slotted row must never be a candidate");
    assert.ok(!candidateIds.includes(attached), "a row attached to a product must never be a candidate");
  });

  it("dry run (default) reports candidates but deletes nothing", async () => {
    const orphan = await createAssetAt(new Date(Date.now() - 72 * 60 * 60 * 1000));

    const code = await runCli([], scopedDb([orphan]));
    assert.equal(code, 0);

    assert.ok(await db.mediaAsset.findUnique({ where: { id: orphan } }), "dry run must never delete anything");
  });

  it("--execute deletes only the provably-orphaned rows in scope, leaving an attached one alone", async () => {
    const unique = randomUUID().slice(0, 8);
    const oldEnough = new Date(Date.now() - 72 * 60 * 60 * 1000);

    const orphan = await createAssetAt(oldEnough);

    const category = await db.category.create({
      data: { name: `Cleanup Exec Test Category ${unique}`, slug: `cleanup-exec-test-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);
    const adminId = await findAnyAdminId();
    const product = await createProduct({ name: `Cleanup Exec Test Product ${unique}`, categoryId: category.id, price: 500 }, adminId);
    createdProductIds.push(product.id);
    const attached = await createAssetAt(oldEnough);
    await addProductImage(product.id, attached, {}, adminId);

    const code = await runCli(["--execute"], scopedDb([orphan, attached]));
    assert.equal(code, 0);

    assert.equal(await db.mediaAsset.findUnique({ where: { id: orphan } }), null, "the orphaned row should be deleted");
    assert.ok(await db.mediaAsset.findUnique({ where: { id: attached } }), "the attached row must survive --execute");
  });

  it("respects a custom --older-than-hours grace period", async () => {
    const oneHourOld = await createAssetAt(new Date(Date.now() - 60 * 60 * 1000));

    const tooStrict = await runCli(["--execute"], scopedDb([oneHourOld]));
    assert.equal(tooStrict, 0);
    assert.ok(await db.mediaAsset.findUnique({ where: { id: oneHourOld } }), "1h old must survive the default 48h grace period");

    const relaxed = await runCli(["--execute", "--older-than-hours=0"], scopedDb([oneHourOld]));
    assert.equal(relaxed, 0);
    assert.equal(await db.mediaAsset.findUnique({ where: { id: oneHourOld } }), null, "must be deleted once the grace period is relaxed to 0h");
  });
});
