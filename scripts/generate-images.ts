import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { revalidateTag } from "next/cache";
import type { MediaUsage, PrismaClient } from "@/generated/prisma/client";
import {
  categoryImageSlot,
  IMAGE_MANIFEST,
  toGenerationAspect,
} from "@/data/media/image-manifest";
import {
  DailyLimitReachedError,
  generateImage,
  GenerationFailedError,
  isImageGenerationConfigured,
  type OpenAIImageClient,
} from "@/lib/ai/image-generation";
import type { AspectRatio, PromptFields, PromptPreset } from "@/lib/ai/prompt-presets";
import { buildPrompt } from "@/lib/ai/prompt-presets";
import { db as defaultDb } from "@/lib/db";
import type { StorageDeps } from "@/lib/media/store";
import { CATEGORIES_CACHE_TAG, PRODUCTS_CACHE_TAG } from "@/lib/products";
import { isR2Configured } from "@/lib/storage/r2";

type Database = PrismaClient;

/**
 * Phase E3 bulk image generation. This is the batch counterpart to the
 * per-product/per-slot "Generate with AI" buttons already in the admin
 * (src/components/admin/product-image-gallery.tsx,
 * src/components/admin/site-images-grid.tsx) — same underlying
 * `generateImage`/`saveMediaAsset` pipeline, just driven over every
 * image-needing row in one run instead of clicking through each one.
 *
 * Run via `npm run images:generate -- [--dry-run] [--only=slots|products|categories] [--limit=N] [--yes]`.
 */

// Caps the number of AI images generated per product (one distinct colour
// each) so a product with a long colour list doesn't dominate a run's
// cost — 3 covers the vast majority of the draft catalog's colourways
// while keeping a 57-product run in the low hundreds of calls rather than
// unbounded.
export const MAX_COLORS_PER_PRODUCT = 3;

export const DEFAULT_CONCURRENCY = 2;

/**
 * Placeholder per-image estimate for a "medium" quality 1024-class GPT
 * image request. Verify the current figure at
 * https://platform.openai.com/pricing before relying on this for real
 * budgeting — OpenAI's published image pricing changes independently of
 * this codebase and isn't fetched at runtime.
 */
export const ESTIMATED_COST_PER_IMAGE_USD = 0.04;

export function estimateCostUsd(jobCount: number): number {
  return Number((jobCount * ESTIMATED_COST_PER_IMAGE_USD).toFixed(2));
}

// ---------------------------------------------------------------------------
// Job planning
// ---------------------------------------------------------------------------

export type ImageJobGroup = "slots" | "products" | "categories";

interface JobBase {
  group: ImageJobGroup;
  /** Stable, human-legible identifier for reports and dry-run listings. */
  id: string;
  label: string;
  preset: PromptPreset;
  aspect: AspectRatio;
  fields?: PromptFields;
  usage: MediaUsage;
  slot?: string;
  alt: string;
}

export interface SlotJob extends JobBase {
  group: "slots";
}

export interface ProductJob extends JobBase {
  group: "products";
  productId: string;
  color: string | null;
  sortOrder: number;
}

export interface CategoryJob extends JobBase {
  group: "categories";
  categoryId: string;
}

export type ImageJob = SlotJob | ProductJob | CategoryJob;

/** The prompt this job would send — computed the same way `generateImage`
 * builds it internally (pure function, no I/O), so the dry-run listing is
 * guaranteed to match what a real run would actually generate. */
export function promptForJob(job: ImageJob): string {
  return buildPrompt(job.preset, job.fields ?? {});
}

export async function planSlotJobs(database: Database): Promise<SlotJob[]> {
  const slots = IMAGE_MANIFEST.map((entry) => entry.slot);
  const existing = await database.mediaAsset.findMany({
    where: { slot: { in: slots } },
    select: { slot: true },
  });
  const filled = new Set(existing.map((asset) => asset.slot));

  return IMAGE_MANIFEST.filter((entry) => !filled.has(entry.slot)).map((entry) => ({
    group: "slots",
    id: entry.slot,
    label: entry.label,
    preset: entry.preset,
    aspect: toGenerationAspect(entry.aspect),
    fields: entry.fields,
    usage: entry.usage,
    slot: entry.slot,
    alt: entry.label,
  }));
}

/**
 * Categories without an `imageId` — that field (not the `category.{slug}`
 * manifest slot, which only drives the admin Site Images preview grid) is
 * what the storefront's category tree actually renders
 * (src/lib/products/index.ts `fetchActiveCategoriesFlat`), so it's the
 * correct "needs an image" signal. The generated asset is given both the
 * manifest slot (for admin Site Images consistency) and linked via
 * `imageId` (for the storefront to actually show it) — see
 * `persistJobResult` below.
 */
export async function planCategoryJobs(database: Database): Promise<CategoryJob[]> {
  const categories = await database.category.findMany({
    where: { imageId: null },
    select: { id: true, slug: true, name: true },
  });

  return categories.map((category) => {
    const entry = categoryImageSlot(category);
    return {
      group: "categories",
      id: `category:${category.slug}`,
      label: entry.label,
      preset: entry.preset,
      aspect: toGenerationAspect(entry.aspect),
      fields: entry.fields,
      usage: entry.usage,
      slot: entry.slot,
      alt: entry.label,
      categoryId: category.id,
    };
  });
}

/**
 * Products with zero `ProductImage` rows, one job per distinct variant
 * colour (capped at `MAX_COLORS_PER_PRODUCT`). A product with no variants
 * at all still gets exactly one job with no colour. Apparel-only product
 * photography, per the `product` preset (src/lib/ai/prompt-presets.ts) —
 * no separate "scene" style is invented here.
 */
export async function planProductJobs(database: Database): Promise<ProductJob[]> {
  const products = await database.product.findMany({
    where: { images: { none: {} } },
    select: {
      id: true,
      slug: true,
      name: true,
      fabric: true,
      gender: true,
      category: { select: { name: true } },
      variants: { select: { color: true } },
    },
  });

  const jobs: ProductJob[] = [];
  for (const product of products) {
    const distinctColors = [...new Set(product.variants.map((variant) => variant.color))];
    const colors: Array<string | null> =
      distinctColors.length > 0 ? distinctColors.slice(0, MAX_COLORS_PER_PRODUCT) : [null];

    colors.forEach((color, index) => {
      jobs.push({
        group: "products",
        id: `product:${product.slug}:${color ?? "default"}`,
        label: color ? `${product.name} (${color})` : product.name,
        preset: "product",
        aspect: "square",
        fields: {
          name: product.name,
          color: color ?? undefined,
          category: product.category.name,
          gender: product.gender.toLowerCase(),
          fabric: product.fabric ?? undefined,
        },
        usage: "PRODUCT",
        alt: color ? `${product.name} — ${color}` : product.name,
        productId: product.id,
        color,
        sortOrder: index,
      });
    });
  }

  return jobs;
}

export interface PlanOptions {
  only?: ImageJobGroup;
  limit?: number;
}

export async function buildPlan(database: Database, options: PlanOptions = {}): Promise<ImageJob[]> {
  const groups: ImageJobGroup[] = options.only ? [options.only] : ["slots", "categories", "products"];

  let jobs: ImageJob[] = [];
  if (groups.includes("slots")) jobs = jobs.concat(await planSlotJobs(database));
  if (groups.includes("categories")) jobs = jobs.concat(await planCategoryJobs(database));
  if (groups.includes("products")) jobs = jobs.concat(await planProductJobs(database));

  if (options.limit !== undefined) jobs = jobs.slice(0, options.limit);
  return jobs;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function safeRevalidate(tag: string) {
  try {
    revalidateTag(tag, "max");
  } catch {
    // No static generation store in this context (standalone script) —
    // nothing to revalidate, mirrors the same pattern in
    // src/lib/catalog/product-import.ts and src/lib/media/store.ts.
  }
}

const RETRYABLE_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries only `GenerationFailedError` (a wrapped upstream/network
 * failure) with exponential backoff; `DailyLimitReachedError` and any
 * other error is rethrown immediately since retrying those can't help. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRYABLE_MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!(error instanceof GenerationFailedError) || attempt === RETRYABLE_MAX_ATTEMPTS) {
        throw error;
      }
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

/** Runs `fn` over `items` with at most `concurrency` in flight at once. */
async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

async function persistJobResult(database: Database, job: ImageJob, assetId: string): Promise<void> {
  if (job.group === "products") {
    await database.productImage.create({
      data: { productId: job.productId, mediaId: assetId, color: job.color, sortOrder: job.sortOrder },
    });
    safeRevalidate(PRODUCTS_CACHE_TAG);
  } else if (job.group === "categories") {
    await database.category.update({ where: { id: job.categoryId }, data: { imageId: assetId } });
    safeRevalidate(CATEGORIES_CACHE_TAG);
  }
  // Slots need nothing further — generateImage() already recorded the
  // slot on the MediaAsset itself (src/lib/media/store.ts saveMediaAsset).
}

export interface RunReportEntry {
  id: string;
  group: ImageJobGroup;
  label: string;
  slot?: string;
  assetId?: string;
  url?: string;
  error?: string;
}

export interface ExecuteDeps {
  db: Database;
  client?: OpenAIImageClient;
  storage?: StorageDeps;
  createdById?: string;
  concurrency?: number;
}

export interface ExecuteResult {
  generated: RunReportEntry[];
  failed: RunReportEntry[];
  skippedDailyLimit: RunReportEntry[];
}

export async function executeJobs(jobs: ImageJob[], deps: ExecuteDeps): Promise<ExecuteResult> {
  const generated: RunReportEntry[] = [];
  const failed: RunReportEntry[] = [];
  const skippedDailyLimit: RunReportEntry[] = [];
  let dailyLimitReached = false;

  await mapWithConcurrency(jobs, deps.concurrency ?? DEFAULT_CONCURRENCY, async (job) => {
    if (dailyLimitReached) {
      skippedDailyLimit.push({ id: job.id, group: job.group, label: job.label, slot: job.slot });
      return;
    }

    try {
      const asset = await withRetry(() =>
        generateImage(
          {
            preset: job.preset,
            fields: job.fields,
            aspect: job.aspect,
            usage: job.usage,
            slot: job.slot,
            alt: job.alt,
            createdById: deps.createdById,
          },
          { client: deps.client, storage: deps.storage },
        ),
      );

      await persistJobResult(deps.db, job, asset.id);
      generated.push({ id: job.id, group: job.group, label: job.label, slot: job.slot, assetId: asset.id, url: asset.url });
    } catch (error) {
      if (error instanceof DailyLimitReachedError) {
        dailyLimitReached = true;
        skippedDailyLimit.push({ id: job.id, group: job.group, label: job.label, slot: job.slot, error: error.message });
        return;
      }
      failed.push({
        id: job.id,
        group: job.group,
        label: job.label,
        slot: job.slot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { generated, failed, skippedDailyLimit };
}

// ---------------------------------------------------------------------------
// Run report
// ---------------------------------------------------------------------------

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  only: ImageJobGroup | "all";
  requested: number;
  generated: RunReportEntry[];
  failed: RunReportEntry[];
  skippedDailyLimit: RunReportEntry[];
  estimatedCostUsd: number;
  /**
   * The `OpenAIImageClient` interface (src/lib/ai/image-generation.ts)
   * deliberately narrows the real OpenAI response down to `data` only, so
   * no token/usage figures reach `generateImage`'s caller today. Real
   * per-run spend must be checked in the OpenAI dashboard until that
   * plumbing is added; this stays `null` rather than a fabricated number.
   */
  actualCostUsd: null;
}

export const RUN_REPORT_PATH = path.join("dogfood-output", "image-run.json");

export async function writeRunReport(report: RunReport, filePath = RUN_REPORT_PATH): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliOptions {
  dryRun: boolean;
  only?: ImageJobGroup;
  limit?: number;
  yes: boolean;
}

const ONLY_VALUES: ImageJobGroup[] = ["slots", "products", "categories"];

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, yes: false };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--yes") {
      options.yes = true;
    } else if (arg.startsWith("--only=")) {
      const value = arg.slice("--only=".length);
      if (!ONLY_VALUES.includes(value as ImageJobGroup)) {
        throw new Error(`--only must be one of ${ONLY_VALUES.join(", ")}, got "${value}"`);
      }
      options.only = value as ImageJobGroup;
    } else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
        throw new Error(`--limit must be a positive integer, got "${arg.slice("--limit=".length)}"`);
      }
      options.limit = value;
    } else {
      throw new Error(`Unrecognized argument: "${arg}"`);
    }
  }

  return options;
}

function describeJob(job: ImageJob): string {
  const prompt = promptForJob(job);
  return `  [${job.group}] ${job.id} — ${job.label}\n    prompt: ${prompt}`;
}

function summarizeCounts(jobs: ImageJob[]): string {
  const counts: Record<ImageJobGroup, number> = { slots: 0, products: 0, categories: 0 };
  for (const job of jobs) counts[job.group] += 1;
  return `slots=${counts.slots} products=${counts.products} categories=${counts.categories} total=${jobs.length}`;
}

/**
 * Missing-config early exit, mirroring the friendly 503 messages the
 * admin API routes already return for the same checks (see
 * src/app/api/admin/media/generate/route.ts and
 * src/app/api/admin/media/route.ts) instead of letting a real run crash
 * with a raw exception.
 */
function describeMissingConfig(): string[] {
  const missing: string[] = [];
  if (!isImageGenerationConfigured()) {
    missing.push("OPENAI_API_KEY (AI image generation) — see src/lib/ai/image-generation.ts");
  }
  if (!isR2Configured()) {
    missing.push(
      "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL (Cloudflare R2 storage) — see src/lib/storage/r2.ts",
    );
  }
  return missing;
}

export async function runCli(argv: string[], database: Database = defaultDb): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  const jobs = await buildPlan(database, { only: options.only, limit: options.limit });

  console.log(`Image generation plan: ${summarizeCounts(jobs)}`);
  console.log(`Estimated cost: $${estimateCostUsd(jobs.length).toFixed(2)} (at $${ESTIMATED_COST_PER_IMAGE_USD}/image — verify at platform.openai.com/pricing)`);

  if (jobs.length === 0) {
    console.log("Nothing to generate — every slot, product, and category already has an image.");
    return 0;
  }

  if (options.dryRun) {
    console.log("\n--dry-run: no API calls will be made, nothing will be written.\n");
    for (const job of jobs) console.log(describeJob(job));
    return 0;
  }

  if (!options.yes) {
    console.log("\nThis was a dry summary only. Re-run with --yes to actually generate these images.");
    return 0;
  }

  const missing = describeMissingConfig();
  if (missing.length > 0) {
    console.error("\nCan't run image generation yet — missing configuration:");
    for (const item of missing) console.error(`  - ${item}`);
    console.error("\nAdd the missing environment variable(s) and re-run.");
    return 1;
  }

  const startedAt = new Date().toISOString();
  const { generated, failed, skippedDailyLimit } = await executeJobs(jobs, { db: database });
  const finishedAt = new Date().toISOString();

  console.log(`\nGenerated ${generated.length}, failed ${failed.length}, skipped (daily limit) ${skippedDailyLimit.length}.`);
  if (failed.length > 0) {
    console.log("Failures:");
    for (const entry of failed) console.log(`  - ${entry.id}: ${entry.error}`);
  }

  const report: RunReport = {
    startedAt,
    finishedAt,
    only: options.only ?? "all",
    requested: jobs.length,
    generated,
    failed,
    skippedDailyLimit,
    estimatedCostUsd: estimateCostUsd(jobs.length),
    actualCostUsd: null,
  };
  await writeRunReport(report);
  console.log(`\nRun report written to ${RUN_REPORT_PATH}`);

  return failed.length > 0 ? 1 : 0;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  runCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await defaultDb.$disconnect();
    });
}
