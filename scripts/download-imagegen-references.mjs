/** Download exact existing product photos for visual inspection and editing. */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";

const slugs = new Set(process.argv.slice(2));
if (slugs.size === 0) throw new Error("Pass one or more product slugs");
const rows = JSON.parse(readFileSync("dogfood-output/imagegen/catalog-reference-map.json", "utf8"))
  .filter((row) => slugs.has(row.productSlug) && row.referenceKey);
const base = "dogfood-output/imagegen/references/catalog";
mkdirSync(base, { recursive: true });
const result = [];
for (const row of rows) {
  const url = `https://storefront-nu-woad.vercel.app/cdn/${row.referenceKey}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error(`${url}: HTTP ${response.status}`);
  const file = path.join(base, `${row.productSlug}-${row.color.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.webp`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  result.push({ ...row, file });
}
const tileWidth = 300, tileHeight = 360;
const composites = [];
for (let i = 0; i < result.length; i++) {
  const row = result[i];
  const thumb = await sharp(row.file).resize(tileWidth, 300, { fit: "contain", background: "white" }).png().toBuffer();
  const label = `<svg width="${tileWidth}" height="60"><rect width="100%" height="100%" fill="#fff"/><text x="8" y="20" font-family="Arial" font-size="13">${row.productSlug}</text><text x="8" y="43" font-family="Arial" font-size="14">${row.color}</text></svg>`;
  const x = (i % 4) * tileWidth, y = Math.floor(i / 4) * tileHeight;
  composites.push({ input: thumb, left: x, top: y }, { input: Buffer.from(label), left: x, top: y + 300 });
}
const width = Math.min(result.length, 4) * tileWidth;
const height = Math.ceil(result.length / 4) * tileHeight;
const sheetName = [...slugs].join("-");
const sheet = path.join(base, `contact-${sheetName.length > 96
  ? createHash("sha256").update(sheetName).digest("hex").slice(0, 16)
  : sheetName}.png`);
await sharp({ create: { width, height, channels: 3, background: "white" } }).composite(composites).png().toFile(sheet);
console.log(JSON.stringify({ rows: result, contactSheet: sheet }, null, 2));
