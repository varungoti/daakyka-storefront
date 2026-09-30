/** Read-only release preflight for every reviewed ChatGPT Images catalog row. */
import { readFileSync } from "node:fs";

const base = new URL(process.argv[2] ?? "https://storefront-nu-woad.vercel.app");
const rows = JSON.parse(readFileSync("src/data/media/generated-product-views.json", "utf8"));
const grouped = new Map();
for (const row of rows) {
  if (!grouped.has(row.productSlug)) grouped.set(row.productSlug, []);
  grouped.get(row.productSlug).push(row);
}
const failures = [];
let checkedImages = 0;
let siblingColourInterpretations = 0;
async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`${url}: HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }
  throw lastError;
}
for (const [slug, entries] of grouped) {
  const response = await fetchWithRetry(new URL(`/products/${slug}`, base));
  if (!response.ok) { failures.push(`${slug}: product HTTP ${response.status}`); continue; }
  const html = await response.text();
  const match = html.match(/\\"images\\":\[([^\]]*)\]/);
  if (!match) { failures.push(`${slug}: images payload missing`); continue; }
  const images = JSON.parse(`[${match[1].replaceAll('\\"', '"')}]`);
  const colours = new Set(entries.map((entry) => entry.color));
  for (const entry of entries) {
    const sourceColor = entry.referenceColor ?? entry.color;
    if (entry.referenceColor) siblingColourInterpretations++;
    if (!images.some((image) => image.url === `/cdn/${entry.referenceKey}` &&
      (image.color === sourceColor || (colours.size === 1 && !entry.referenceColor && image.color === null)))) {
      failures.push(`${slug}/${entry.color}: reference photo not linked`);
      continue;
    }
    const imageResponse = await fetchWithRetry(new URL(`/cdn/${entry.key}`, base), { method: "HEAD" });
    if (!imageResponse.ok || !imageResponse.headers.get("content-type")?.startsWith("image/webp")) {
      failures.push(`${slug}/${entry.color}/${entry.view}: uploaded image HTTP ${imageResponse.status}`);
    } else checkedImages++;
  }
}
console.log(JSON.stringify({ products: grouped.size, manifestImages: rows.length, checkedImages,
  siblingColourInterpretations, failures }, null, 2));
if (failures.length) process.exitCode = 1;
