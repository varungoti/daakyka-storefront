/** Read-only public catalog reference inventory for ChatGPT Images review. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const csv = process.argv[2];
if (!csv) throw new Error("Pass product-photo-shot-list CSV path");
const rows = readFileSync(csv, "utf8").trim().split(/\r?\n/).slice(1).map((line) => {
  const match = line.match(/^"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)","([^"]+)"$/);
  if (!match) throw new Error(`Cannot parse photo shot-list row: ${line}`);
  return { productSlug: match[1], productName: match[2], color: match[3], sizes: match[4], existing: Number(match[5]), needed: Number(match[6]) };
});
const byProduct = new Map();
for (const row of rows) {
  if (!byProduct.has(row.productSlug)) byProduct.set(row.productSlug, []);
  byProduct.get(row.productSlug).push(row);
}
const report = [];
for (const [productSlug, gaps] of byProduct) {
  const url = `https://storefront-nu-woad.vercel.app/products/${productSlug}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const html = await response.text();
  const match = html.match(/\\"images\\":\[([^\]]*)\]/);
  if (!match) throw new Error(`No product images payload: ${productSlug}`);
  const images = JSON.parse(`[${match[1].replaceAll('\\"', '"')}]`);
  for (const gap of gaps) {
    const matching = images.filter((image) => image.color === gap.color || (gaps.length === 1 && !image.color));
    const referenceKey = matching[0]?.url?.replace(/^\/cdn\//, "") ?? null;
    report.push({ ...gap, referenceKey, otherColourReference: referenceKey ? null : images[0]?.url?.replace(/^\/cdn\//, "") ?? null });
  }
}
const outDir = "dogfood-output/imagegen";
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "catalog-reference-map.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  products: byProduct.size,
  gaps: report.length,
  withExactReference: report.filter((row) => row.referenceKey).length,
  withoutExactReference: report.filter((row) => !row.referenceKey).map(({ productSlug, color }) => ({ productSlug, color })),
}, null, 2));
