/** Read-only comparison of private R2 product objects and public PDP references.
 * Run with a locally configured env file; never prints credential values.
 */
import https from "node:https";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const base = new URL(process.argv[2] ?? "https://storefront-nu-woad.vercel.app");
const accountId = process.env.R2_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? process.env.CLOUDFLARE_ACCESS_KEY_ID ?? process.env.CLOUDFLARE_ACCESS_KEY;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.CLOUDFLARE_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  throw new Error("R2 account/key/secret/bucket environment is incomplete");
}

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
  requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true }) }),
});

async function listProductObjects() {
  const keys = new Set();
  let cursor;
  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: "media/product/",
      ContinuationToken: cursor,
      MaxKeys: 1000,
    }));
    for (const object of page.Contents ?? []) if (object.Key) keys.add(object.Key);
    cursor = page.NextContinuationToken;
  } while (cursor);
  return keys;
}

async function fetchText(path) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.text();
}

const objects = await listProductObjects();
const api = JSON.parse(await fetchText("/api/products"));
const products = Array.isArray(api) ? api : api.products;
if (!Array.isArray(products)) throw new Error("Products API returned an unexpected shape");

const references = new Map();
const failures = [];
for (let offset = 0; offset < products.length; offset += 5) {
  await Promise.all(products.slice(offset, offset + 5).map(async (product) => {
    const path = `/products/${encodeURIComponent(product.handle)}`;
    try {
      const html = (await fetchText(path)).replaceAll("\\/", "/");
      const keys = new Set(html.match(/media\/product\/(?:\d{4}\/\d{2}\/[a-z0-9-]+|chatgpt\/\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\/[a-z0-9-]+)\.webp/gi) ?? []);
      for (const key of keys) {
        if (!references.has(key)) references.set(key, []);
        references.get(key).push(product.handle);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }));
}

const unreferenced = [...objects].filter((key) => !references.has(key)).sort();
const missing = [...references.keys()].filter((key) => !objects.has(key)).sort();
const report = {
  base: base.origin,
  productPages: products.length,
  storedProductObjects: objects.size,
  referencedProductObjects: references.size,
  unreferencedProductObjects: unreferenced,
  missingStoredObjects: missing,
  pageFailures: failures,
  note: "PDP HTML references and R2 object existence do not prove colour, size, or image relevance.",
};
console.log(JSON.stringify(report, null, 2));
if (missing.length || failures.length) process.exitCode = 1;
