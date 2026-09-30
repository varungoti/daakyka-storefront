/** Build a local upload batch only from manually approved ChatGPT Images files. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const approvedDir = "dogfood-output/imagegen/final";
const referenceMap = JSON.parse(readFileSync("dogfood-output/imagegen/catalog-reference-map.json", "utf8"));
const manifested = new Set(JSON.parse(readFileSync("src/data/media/generated-product-views.json", "utf8"))
  .map((row) => `${row.productSlug}\0${row.color}\0${row.view}`));
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const approved = readdirSync(approvedDir).filter((file) => file.endsWith(".png"));
const batch = approved.map((file) => {
  const matching = referenceMap.filter((row) => (row.referenceKey || row.otherColourReference) &&
    file.startsWith(`${row.productSlug}-${slug(row.color)}-`));
  if (matching.length !== 1) throw new Error(`No unique exact reference for approved file: ${file}`);
  const row = matching[0];
  const referenceKey = row.referenceKey || row.otherColourReference;
  const sibling = row.referenceKey ? null : referenceMap.find((candidate) =>
    candidate.productSlug === row.productSlug && candidate.referenceKey === referenceKey);
  if (!row.referenceKey && (!sibling || sibling.color === row.color)) {
    throw new Error(`No same-product sibling reference for ${row.productSlug}/${row.color}`);
  }
  const view = file.slice(`${row.productSlug}-${slug(row.color)}-`.length, -4);
  if (!view) throw new Error(`Missing view label: ${file}`);
  return {
    productSlug: row.productSlug,
    productName: row.productName,
    color: row.color,
    view,
    referenceKey,
    ...(sibling ? { referenceColor: sibling.color } : {}),
    file: `final/${file}`,
    prompt: sibling
      ? `ChatGPT Images colour interpretation of ${row.productName} in ${row.color}, based on the same product's ${sibling.color} catalog photo: one square photorealistic ${view} product view. This is representative and the target colour/design requires seller verification; no logos, text, invented patterns, or extra design features.`
      : `ChatGPT Images reference-led edit of the exact ${row.productName} in ${row.color}: one square photorealistic ${view} product view consistent with the catalog garment or textile, with no logos, text, invented patterns, or extra design features.`,
  };
}).filter((row) => !manifested.has(`${row.productSlug}\0${row.color}\0${row.view}`));
const output = "dogfood-output/imagegen/batch-extra.json";
writeFileSync(output, `${JSON.stringify(batch, null, 2)}\n`);
console.log(`${batch.length} approved images prepared in ${output}`);
