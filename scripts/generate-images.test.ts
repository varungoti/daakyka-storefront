import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, rm } from "node:fs/promises";
import sharp from "sharp";
import { db } from "@/lib/db";
import type { OpenAIImageClient } from "@/lib/ai/image-generation";
import type { StorageDeps } from "@/lib/media/store";
import { withEnv } from "../tests/helpers/env";
import {
  buildPlan,
  ESTIMATED_COST_PER_IMAGE_USD,
  estimateCostUsd,
  executeJobs,
  MAX_COLORS_PER_PRODUCT,
  parseCliArgs,
  planCategoryJobs,
  planProductJobs,
  planSlotJobs,
  promptForJob,
  runCli,
  writeRunReport,
  type ImageJob,
} from "./generate-images";

/**
 * Phase E3 tests for the bulk image-generation script. Requires a running
 * Postgres (storefront-postgres-1), same as the rest of the integration
 * suite. Every row this file creates is cleaned up in `after()`.
 *
 * These tests deliberately never call `executeJobs`/`runCli`'s execution
 * branch against the *full, unfiltered* plan — the shared dev DB has
 * dozens of real slots/products/categories genuinely missing images (that
 * is the whole point of this script), and the manual
 * `npm run images:generate -- --dry-run` verification of this task
 * depends on that count still being accurate after `npm test` runs. Every
 * test below scopes execution to rows it created itself, or exercises
 * branches (dry-run, missing-config, argument parsing) that never write
 * anything.
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

async function tinyPngB64(): Promise<string> {
  const buffer = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 5, g: 5, b: 5 } },
  })
    .png()
    .toBuffer();
  return buffer.toString("base64");
}

function makeFakeOpenAIClient(b64: string): OpenAIImageClient {
  return {
    images: {
      generate: async () => ({ data: [{ b64_json: b64 }] }),
    },
  };
}

function captureConsole() {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    },
  };
}

const createdMediaAssetIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdProductIds: string[] = [];

after(async () => {
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
  if (createdCategoryIds.length > 0) {
    // Clear imageId first — Category.image uses onDelete: SetNull, so this
    // isn't strictly required, but keeps ordering explicit either way.
    await db.category.updateMany({ where: { id: { in: createdCategoryIds } }, data: { imageId: null } });
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } });
  }
  if (createdMediaAssetIds.length > 0) {
    await db.mediaAsset.deleteMany({ where: { id: { in: createdMediaAssetIds } } });
  }
});

describe("estimateCostUsd", () => {
  it("multiplies the job count by the documented per-image estimate", () => {
    assert.equal(estimateCostUsd(10), Number((10 * ESTIMATED_COST_PER_IMAGE_USD).toFixed(2)));
    assert.equal(estimateCostUsd(0), 0);
  });
});

describe("parseCliArgs", () => {
  it("parses no flags to all-false defaults", () => {
    assert.deepEqual(parseCliArgs([]), { dryRun: false, yes: false });
  });

  it("parses --dry-run, --yes, --only, --limit together", () => {
    assert.deepEqual(parseCliArgs(["--dry-run", "--yes", "--only=products", "--limit=5"]), {
      dryRun: true,
      yes: true,
      only: "products",
      limit: 5,
    });
  });

  it("rejects an invalid --only value", () => {
    assert.throws(() => parseCliArgs(["--only=bogus"]), /--only must be one of/);
  });

  it("rejects a non-positive or non-integer --limit", () => {
    assert.throws(() => parseCliArgs(["--limit=0"]), /--limit must be a positive integer/);
    assert.throws(() => parseCliArgs(["--limit=abc"]), /--limit must be a positive integer/);
    assert.throws(() => parseCliArgs(["--limit=1.5"]), /--limit must be a positive integer/);
  });

  it("rejects an unrecognized argument", () => {
    assert.throws(() => parseCliArgs(["--bogus"]), /Unrecognized argument/);
  });
});

describe("planCategoryJobs", () => {
  it("includes a real category with no imageId, and excludes it once one is set (resumability)", async () => {
    const unique = randomUUID().slice(0, 8);
    const category = await db.category.create({
      data: { name: `E3 Test Category ${unique}`, slug: `e3-test-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);

    const before = await planCategoryJobs(db);
    const job = before.find((j) => j.categoryId === category.id);
    assert.ok(job, "expected the freshly created category to need an image");
    assert.equal(job.preset, "category-tile");
    assert.equal(job.slot, `category.${category.slug}`);
    assert.ok(promptForJob(job).includes(category.name));

    // Simulate having generated its image already.
    const asset = await db.mediaAsset.create({
      data: {
        key: `media/category/e3-test/${randomUUID()}.webp`,
        url: "https://fake-r2.test/e3-category.webp",
        usage: "CATEGORY",
        source: "UPLOAD",
      },
    });
    createdMediaAssetIds.push(asset.id);
    await db.category.update({ where: { id: category.id }, data: { imageId: asset.id } });

    const after1 = await planCategoryJobs(db);
    assert.ok(
      !after1.some((j) => j.categoryId === category.id),
      "a category with imageId set must be skipped on the next plan",
    );
  });
});

describe("planProductJobs", () => {
  it("caps at MAX_COLORS_PER_PRODUCT jobs, one per distinct colour, and excludes a product once it has any image", async () => {
    const unique = randomUUID().slice(0, 8);
    const category = await db.category.create({
      data: { name: `E3 Product Category ${unique}`, slug: `e3-product-category-${unique}`, section: "HOSPITAL" },
    });
    createdCategoryIds.push(category.id);

    const colors = ["Navy", "Wine", "Ceil Blue", "Black"]; // 4 colours — more than the cap
    const product = await db.product.create({
      data: {
        name: `E3 Test Scrub Set ${unique}`,
        slug: `e3-test-scrub-set-${unique}`,
        categoryId: category.id,
        price: 999,
        fabric: "Poly-cotton 65/35",
        gender: "WOMEN",
        variants: {
          create: colors.map((color, index) => ({
            sku: `E3-TEST-${unique}-${index}`,
            size: "M",
            color,
          })),
        },
      },
    });
    createdProductIds.push(product.id);

    const jobs = await planProductJobs(db);
    const productJobs = jobs.filter((j) => j.productId === product.id);
    assert.equal(productJobs.length, MAX_COLORS_PER_PRODUCT, "must cap at MAX_COLORS_PER_PRODUCT jobs per product");
    assert.deepEqual(
      productJobs.map((j) => j.color),
      colors.slice(0, MAX_COLORS_PER_PRODUCT),
    );
    for (const job of productJobs) {
      assert.equal(job.preset, "product");
      assert.equal(job.usage, "PRODUCT");
      assert.equal(job.fields?.name, product.name);
      assert.equal(job.fields?.fabric, "Poly-cotton 65/35");
      assert.equal(job.fields?.gender, "women");
      const prompt = promptForJob(job);
      assert.ok(prompt.includes(product.name));
      assert.ok(prompt.includes(job.color!));
    }

    // Attach one image directly (bypassing the script) and confirm the
    // whole product — not just that one colour — drops out of the plan,
    // matching "zero ProductImage rows" as the needs-an-image signal.
    const asset = await db.mediaAsset.create({
      data: {
        key: `media/product/e3-test/${randomUUID()}.webp`,
        url: "https://fake-r2.test/e3-product.webp",
        usage: "PRODUCT",
        source: "UPLOAD",
      },
    });
    createdMediaAssetIds.push(asset.id);
    await db.productImage.create({ data: { productId: product.id, mediaId: asset.id, sortOrder: 0 } });

    const after1 = await planProductJobs(db);
    assert.ok(!after1.some((j) => j.productId === product.id));
  });

  it("still produces exactly one job (no colour) for a product with zero variants", async () => {
    const unique = randomUUID().slice(0, 8);
    const category = await db.category.create({
      data: { name: `E3 No Variant Category ${unique}`, slug: `e3-no-variant-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);

    const product = await db.product.create({
      data: {
        name: `E3 No Variant Product ${unique}`,
        slug: `e3-no-variant-product-${unique}`,
        categoryId: category.id,
        price: 500,
      },
    });
    createdProductIds.push(product.id);

    const jobs = (await planProductJobs(db)).filter((j) => j.productId === product.id);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].color, null);
  });
});

describe("planSlotJobs", () => {
  it("excludes a manifest slot once a MediaAsset exists for it, and includes it again once removed (resumability)", async () => {
    const targetSlot = "home.hero.1";

    const before = await planSlotJobs(db);
    assert.ok(before.some((j) => j.slot === targetSlot), "expected this environment to have no asset for the slot yet");

    const asset = await db.mediaAsset.create({
      data: {
        key: `media/banner/e3-test/${randomUUID()}.webp`,
        url: "https://fake-r2.test/e3-slot.webp",
        usage: "BANNER",
        source: "UPLOAD",
        slot: targetSlot,
      },
    });

    try {
      const during = await planSlotJobs(db);
      assert.ok(!during.some((j) => j.slot === targetSlot));
    } finally {
      await db.mediaAsset.delete({ where: { id: asset.id } });
    }

    const afterCleanup = await planSlotJobs(db);
    assert.ok(afterCleanup.some((j) => j.slot === targetSlot), "slot must reappear once its asset is removed");
  });
});

describe("buildPlan", () => {
  it("--only restricts to a single group", async () => {
    const jobs = await buildPlan(db, { only: "categories" });
    assert.ok(jobs.length > 0);
    assert.ok(jobs.every((j) => j.group === "categories"));
  });

  it("--limit caps the total across groups", async () => {
    const jobs = await buildPlan(db, { limit: 1 });
    assert.equal(jobs.length, 1);
  });
});

describe("executeJobs + writeRunReport (fake OpenAI client + fake storage — no real network call)", () => {
  it("generates, persists, and reports for a scoped product+category job set, and writes a report with the right shape", async () => {
    const unique = randomUUID().slice(0, 8);
    const category = await db.category.create({
      data: { name: `E3 Exec Category ${unique}`, slug: `e3-exec-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);

    const product = await db.product.create({
      data: {
        name: `E3 Exec Product ${unique}`,
        slug: `e3-exec-product-${unique}`,
        categoryId: category.id,
        price: 700,
        gender: "UNISEX",
        variants: { create: [{ sku: `E3-EXEC-${unique}-1`, size: "M", color: "Navy" }] },
      },
    });
    createdProductIds.push(product.id);

    const [categoryJob] = (await planCategoryJobs(db)).filter((j) => j.categoryId === category.id);
    const [productJob] = (await planProductJobs(db)).filter((j) => j.productId === product.id);
    assert.ok(categoryJob && productJob);

    const jobs: ImageJob[] = [categoryJob, productJob];
    const b64 = await tinyPngB64();

    const result = await withEnv({ OPENAI_API_KEY: "test-key-not-real" }, () =>
      executeJobs(jobs, {
        db,
        client: makeFakeOpenAIClient(b64),
        storage: makeFakeStorage(),
      }),
    );

    assert.equal(result.generated.length, 2);
    assert.equal(result.failed.length, 0);
    assert.equal(result.skippedDailyLimit.length, 0);
    createdMediaAssetIds.push(...result.generated.map((g) => g.assetId!));

    const updatedCategory = await db.category.findUnique({ where: { id: category.id } });
    assert.equal(updatedCategory?.imageId, result.generated.find((g) => g.group === "categories")?.assetId);

    const productImages = await db.productImage.findMany({ where: { productId: product.id } });
    assert.equal(productImages.length, 1);
    assert.equal(productImages[0].color, "Navy");

    const reportPath = path.join("dogfood-output", `image-run.test.${unique}.json`);
    const report = {
      startedAt: new Date(0).toISOString(),
      finishedAt: new Date(1).toISOString(),
      only: "all" as const,
      requested: jobs.length,
      generated: result.generated,
      failed: result.failed,
      skippedDailyLimit: result.skippedDailyLimit,
      estimatedCostUsd: estimateCostUsd(jobs.length),
      actualCostUsd: null,
    };
    await writeRunReport(report, reportPath);

    try {
      const written = JSON.parse(await readFile(reportPath, "utf8"));
      assert.equal(written.requested, 2);
      assert.equal(written.generated.length, 2);
      assert.equal(written.actualCostUsd, null);
      assert.ok(typeof written.estimatedCostUsd === "number");
      assert.ok(typeof written.startedAt === "string" && typeof written.finishedAt === "string");
    } finally {
      await rm(reportPath, { force: true });
    }
  });

  it("records a failure without throwing when the fake client errors", async () => {
    const unique = randomUUID().slice(0, 8);
    const category = await db.category.create({
      data: { name: `E3 Fail Category ${unique}`, slug: `e3-fail-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);

    const [job] = (await planCategoryJobs(db)).filter((j) => j.categoryId === category.id);
    assert.ok(job);

    const failingClient: OpenAIImageClient = {
      images: {
        generate: async () => {
          throw new Error("simulated upstream failure");
        },
      },
    };

    const result = await withEnv({ OPENAI_API_KEY: "test-key-not-real" }, () =>
      executeJobs([job], { db, client: failingClient, storage: makeFakeStorage() }),
    );

    assert.equal(result.generated.length, 0);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].error!, /AI image generation failed/);

    const stillMissing = await db.category.findUnique({ where: { id: category.id } });
    assert.equal(stillMissing?.imageId, null);
  });
});

describe("runCli", () => {
  it("--dry-run prints the plan without generating anything or requiring configuration", async () => {
    const capture = captureConsole();
    let code: number;
    try {
      code = await withEnv(
        { OPENAI_API_KEY: undefined, R2_ACCOUNT_ID: undefined, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined, R2_BUCKET: undefined, R2_PUBLIC_BASE_URL: undefined },
        () => runCli(["--dry-run"], db),
      );
    } finally {
      capture.restore();
    }
    assert.equal(code, 0);
    const output = capture.logs.join("\n");
    assert.match(output, /Image generation plan: slots=\d+ products=\d+ categories=\d+ total=\d+/);
    assert.match(output, /--dry-run: no API calls will be made/);
    assert.ok(!output.includes("Generated "));
  });

  it("without --yes, prints the summary and exits 0 without generating", async () => {
    const capture = captureConsole();
    let code: number;
    try {
      code = await runCli(["--limit=1"], db);
    } finally {
      capture.restore();
    }
    assert.equal(code, 0);
    assert.match(capture.logs.join("\n"), /Re-run with --yes/);
  });

  it("--yes exits 1 with a friendly, non-throwing message when OPENAI_API_KEY/R2 aren't configured", async () => {
    const capture = captureConsole();
    let code: number;
    try {
      code = await withEnv(
        { OPENAI_API_KEY: undefined, R2_ACCOUNT_ID: undefined, R2_ACCESS_KEY_ID: undefined, R2_SECRET_ACCESS_KEY: undefined, R2_BUCKET: undefined, R2_PUBLIC_BASE_URL: undefined },
        () => runCli(["--yes", "--limit=1"], db),
      );
    } finally {
      capture.restore();
    }
    assert.equal(code, 1);
    const errorOutput = capture.errors.join("\n");
    assert.match(errorOutput, /OPENAI_API_KEY/);
    assert.match(errorOutput, /R2_ACCOUNT_ID/);
  });

  it("rejects a bad --only value with exit code 1, not a throw", async () => {
    const capture = captureConsole();
    let code: number;
    try {
      code = await runCli(["--only=bogus"], db);
    } finally {
      capture.restore();
    }
    assert.equal(code, 1);
    assert.match(capture.errors.join("\n"), /--only must be one of/);
  });
});
