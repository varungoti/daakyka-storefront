/** Attach reviewed ChatGPT Images R2 objects to exact catalog colourways.
 * This runs after a production migration and before Next builds static pages.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { db } from "@/lib/db";

export interface ReviewedProductView {
  productSlug: string;
  color: string;
  view: string;
  referenceKey: string;
  key: string;
  alt: string;
  prompt: string;
  model: string;
  width: number;
  height: number;
  applicability: "representative";
  contentSha256: string;
}

export function validateReviewedProductViews(value: unknown): ReviewedProductView[] {
  if (!Array.isArray(value)) throw new Error("Generated product image manifest must be an array");
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object") throw new Error("Invalid generated image row");
    for (const field of ["productSlug", "color", "view", "referenceKey", "key", "alt", "prompt", "model", "contentSha256"]) {
      if (typeof row[field] !== "string" || !row[field]) throw new Error(`Generated image ${field} is required`);
    }
    if (row.applicability !== "representative" || !Number.isInteger(row.width) || !Number.isInteger(row.height)) {
      throw new Error(`Generated image ${row.key} has invalid applicability or dimensions`);
    }
    if (!/^media\/product\/chatgpt\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\/[a-z0-9-]+-[a-f0-9]{64}\.webp$/.test(row.key) ||
        !/^media\/product\/\d{4}\/\d{2}\/[a-z0-9-]+\.webp$/.test(row.referenceKey) ||
        !row.key.endsWith(`${row.contentSha256}.webp`)) {
      throw new Error(`Generated image ${row.key} has an invalid key or reference`);
    }
    if (seen.has(row.key)) throw new Error(`Duplicate generated image key: ${row.key}`);
    seen.add(row.key);
  }
  return value as ReviewedProductView[];
}

const markerFor = (key: string) => `generated-product-view:${key}`;

export async function syncGeneratedProductImages(entries: ReviewedProductView[]) {
  const counts = { linked: 0, previouslySynced: 0 };
  for (const entry of entries) {
    const marker = markerFor(entry.key);
    let result: "linked" | "previouslySynced";
    try {
      result = await db.$transaction(async (tx) => {
      const prior = await tx.siteSetting.findUnique({ where: { key: marker } });
      if (prior) return "previouslySynced" as const;
      const product = await tx.product.findUnique({
        where: { slug: entry.productSlug },
        select: { id: true, status: true,
          variants: { select: { color: true, active: true } },
          images: { select: { color: true, mediaId: true, media: { select: { key: true } } } },
        },
      });
      if (!product || product.status !== "ACTIVE" || !product.variants.some((v) => v.active && v.color === entry.color)) {
        throw new Error(`Missing active product/colour for generated image: ${entry.productSlug}/${entry.color}`);
      }
      const colours = new Set(product.variants.filter((v) => v.active).map((v) => v.color));
      const hasExactReference = product.images.some((image) => image.media.key === entry.referenceKey &&
        (image.color === entry.color || (colours.size === 1 && image.color === null)));
      if (!hasExactReference) {
        throw new Error(`Reference photo is not linked to the exact colour: ${entry.productSlug}/${entry.color}`);
      }
      let asset = await tx.mediaAsset.findUnique({ where: { key: entry.key } });
      if (asset && (asset.source !== "AI" || asset.usage !== "PRODUCT")) {
        throw new Error(`Existing generated key has unexpected media metadata: ${entry.key}`);
      }
      asset ??= await tx.mediaAsset.create({ data: {
        key: entry.key, url: `/cdn/${entry.key}`, alt: entry.alt,
        width: entry.width, height: entry.height, source: "AI", usage: "PRODUCT",
        model: entry.model, prompt: entry.prompt,
      } });
      const existingLink = await tx.productImage.findFirst({ where: { productId: product.id, mediaId: asset.id } });
      if (!existingLink) {
        const maxSort = await tx.productImage.aggregate({ where: { productId: product.id }, _max: { sortOrder: true } });
        await tx.productImage.create({ data: {
          productId: product.id, mediaId: asset.id, color: entry.color,
          size: null, appliesToAllSizes: false, alt: entry.alt,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        } });
      }
      // This permanent marker respects a later admin removal; a redeploy
      // cannot silently reattach an image the merchant took off the PDP.
      await tx.siteSetting.create({ data: { key: marker, value: {
        contentSha256: entry.contentSha256,
        productSlug: entry.productSlug,
        color: entry.color,
        syncedAt: new Date().toISOString(),
      } } });
      return "linked" as const;
      });
    } catch (error) {
      // Two production builds can race after the initial marker read. The
      // unique marker makes one transaction win; the other may safely skip
      // only after confirming that the winner committed its marker.
      if ((error as { code?: string })?.code !== "P2002" ||
          !await db.siteSetting.findUnique({ where: { key: marker } })) throw error;
      result = "previouslySynced";
    }
    counts[result]++;
  }
  return counts;
}

async function main() {
  const entries = validateReviewedProductViews(JSON.parse(readFileSync("src/data/media/generated-product-views.json", "utf8")));
  if (!process.argv.includes("--apply")) {
    console.log(`Validated ${entries.length} reviewed generated product images. Pass --apply to sync.`);
    return;
  }
  if (process.env.VERCEL_ENV !== "production" && process.env.ALLOW_LOCAL_MEDIA_SYNC !== "1") {
    throw new Error("Image manifest sync is restricted to a production build or explicit local test override");
  }
  const counts = await syncGeneratedProductImages(entries);
  console.log(`Generated product image sync: ${JSON.stringify(counts)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }).finally(() => db.$disconnect());
}
