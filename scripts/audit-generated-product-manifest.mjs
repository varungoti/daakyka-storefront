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
for (const [slug, entries] of grouped) {
  const response = await fetch(new URL(`/products/${slug}`, base), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) { failures.push(`${slug}: product HTTP ${response.status}`); continue; }
  const html = await response.text();
  const match = html.match(/\\"images\\":\[([^\]]*)\]/);
  if (!match) { failures.push(`${slug}: images payload missing`); continue; }
  const images = JSON.parse(`[${match[1].replaceAll('\\"', '"')}]`);
  const colours = new Set(entries.map((entry) => entry.color));
  for (const entry of entries) {
    if (!images.some((image) => image.url === `/cdn/${entry.referenceKey}` &&
      (image.color === entry.color || (colours.size === 1 && image.color === null)))) {
      failures.push(`${slug}/${entry.color}: reference photo not linked`);
      continue;
    }
    const imageResponse = await fetch(new URL(`/cdn/${entry.key}`, base), {
      method: "HEAD", signal: AbortSignal.timeout(20000),
    });
    if (!imageResponse.ok || !imageResponse.headers.get("content-type")?.startsWith("image/webp")) {
      failures.push(`${slug}/${entry.color}/${entry.view}: uploaded image HTTP ${imageResponse.status}`);
    } else checkedImages++;
  }
}
console.log(JSON.stringify({ products: grouped.size, manifestImages: rows.length, checkedImages, failures }, null, 2));
if (failures.length) process.exitCode = 1;
