/**
 * Deterministically split ChatGPT Images three-view concept sheets into
 * front/back/detail assets for review and authenticated R2 import.
 * Source-map JSON and output stay in ignored dogfood-output; no generated
 * bitmap is committed or mistaken for a verified supplier photograph.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const sourceMapPath = process.argv[2];
if (!sourceMapPath) throw new Error("Pass dogfood-output/kids-concepts/source-map.json");
const sourceMap = JSON.parse(await readFile(sourceMapPath, "utf8"));
if (!Array.isArray(sourceMap) || sourceMap.length !== 20) throw new Error("Expected exactly 20 concept sheets");
const root = path.dirname(path.resolve(sourceMapPath));
const viewsDirectory = path.join(root, "views");
await mkdir(viewsDirectory, { recursive: true });
const views = ["front", "back", "detail"];
const manifest = [];
const seen = new Set();
for (const item of sourceMap) {
  if (!item.slug || !item.file || seen.has(item.slug)) throw new Error("Invalid or duplicate concept source");
  seen.add(item.slug);
  const file = path.resolve(item.file);
  const metadata = await sharp(file).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 1500 || metadata.height < 600) {
    throw new Error(`Unexpected sheet dimensions for ${item.slug}`);
  }
  const panelWidth = Math.floor(metadata.width / 3);
  for (let index = 0; index < 3; index++) {
    const width = index === 2 ? metadata.width - 2 * panelWidth : panelWidth;
    const buffer = await sharp(file)
      .extract({ left: index * panelWidth, top: 0, width, height: metadata.height })
      .webp({ quality: 85 })
      .toBuffer();
    const output = path.join(viewsDirectory, `${item.slug}-${views[index]}.webp`);
    await writeFile(output, buffer);
    manifest.push({
      slug: item.slug,
      view: views[index],
      file: output,
      sha256: createHash("sha256").update(buffer).digest("hex"),
      alt: `${item.slug.replaceAll("-", " ")}, ${views[index]} view; AI-generated design concept, physical product pending verification`,
      prompt: "ChatGPT Images three-view catalog concept sheet; front, back and construction detail; physical product pending verification",
    });
  }
}
await writeFile(path.join(root, "view-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
for (const view of views) {
  const composites = [];
  for (const [index, item] of sourceMap.entries()) {
    const x = (index % 4) * 320;
    const y = Math.floor(index / 4) * 450;
    composites.push({
      input: await sharp(path.join(viewsDirectory, `${item.slug}-${view}.webp`))
        .resize(300, 380, { fit: "contain", background: "white" }).toBuffer(),
      left: x + 10,
      top: y,
    });
    const caption = `<svg width="320" height="50"><rect width="320" height="50" fill="white"/><text x="10" y="25" font-size="14" font-family="Arial" fill="#222">${item.slug}</text></svg>`;
    composites.push({ input: Buffer.from(caption), left: x, top: y + 380 });
  }
  await sharp({ create: { width: 1280, height: 2250, channels: 3, background: "white" } })
    .composite(composites).webp({ quality: 78 }).toFile(path.join(root, `contact-${view}.webp`));
}
console.log(`Prepared ${manifest.length} AI concept views for ${seen.size} Kids Wear drafts.`);
