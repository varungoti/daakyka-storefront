/**
 * Upload an inspected ChatGPT Images batch to the private R2 product catalog.
 * Input JSON is deliberately local/ignored; only the reviewed, source-linked
 * manifest is committed. Run with --execute for the intentional R2 write.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import sharp from "sharp";

const inputPath = process.argv.find((arg) => arg.endsWith(".json"));
if (!inputPath) throw new Error("Pass the reviewed local batch JSON path");
const execute = process.argv.includes("--execute");
if (execute && process.env.R2_ALLOW_PROD_BUCKET_WRITES !== "1") {
  throw new Error("Intentional production R2 upload requires R2_ALLOW_PROD_BUCKET_WRITES=1");
}
const accountId = process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.CLOUDFLARE_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
if (execute && (!accountId || !accessKeyId || !secretAccessKey || !bucket)) {
  throw new Error("R2 credentials or bucket are incomplete");
}
const client = execute ? new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true }) }),
}) : null;

const rows = JSON.parse(readFileSync(inputPath, "utf8"));
if (!Array.isArray(rows) || rows.length === 0) throw new Error("Batch must contain image rows");
const results = [];
for (const row of rows) {
  const { productSlug, color, view, referenceKey, referenceColor, file, prompt } = row;
  if (![productSlug, color, view, referenceKey, file, prompt].every((item) => typeof item === "string" && item.length > 0)) {
    throw new Error("Each image requires productSlug, color, view, referenceKey, file, and prompt");
  }
  if (!/^media\/product\/\d{4}\/\d{2}\/[a-z0-9-]+\.webp$/.test(referenceKey)) {
    throw new Error(`Invalid catalog reference key for ${productSlug}/${color}`);
  }
  if (referenceColor !== undefined && (typeof referenceColor !== "string" || !referenceColor || referenceColor === color)) {
    throw new Error(`Invalid sibling reference colour for ${productSlug}/${color}`);
  }
  const input = readFileSync(path.resolve(path.dirname(inputPath), file));
  const { data, info } = await sharp(input, { limitInputPixels: 50_000_000 })
    .rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const hash = createHash("sha256").update(data).digest("hex");
  const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const key = `media/product/chatgpt/2026-09-30/${slug(productSlug)}/${slug(color)}-${slug(view)}-${hash}.webp`;
  if (execute) {
    try {
      const existing = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (existing.ContentLength !== data.length) throw new Error(`Existing object length mismatch: ${key}`);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") throw error;
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: "image/webp" }));
      const uploaded = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      if (uploaded.ContentLength !== data.length) throw new Error(`R2 verification failed: ${key}`);
    }
  }
  results.push({ productSlug, color, view, referenceKey,
    ...(referenceColor ? { referenceColor } : {}), key,
    alt: referenceColor
      ? `${row.productName ?? productSlug} in ${color}, ${view} view; AI-generated colour interpretation based on ${referenceColor} catalog reference, not a verified ${color} product photo`
      : `${row.productName ?? productSlug} in ${color}, ${view} view; AI-generated product illustration based on catalog reference`,
    prompt, model: "ChatGPT Images", width: info.width, height: info.height,
    applicability: "representative", contentSha256: hash });
  console.log(`${execute ? "uploaded/verified" : "prepared"}: ${key} (${data.length} bytes)`);
}
const out = path.resolve(path.dirname(inputPath), "reviewed-manifest.json");
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(`${results.length} reviewed image entries written to ${out}`);
