/** Replace only the exact scrub-only seed copy on an existing database. */
import "dotenv/config";
import { db } from "../src/lib/db";

const path = "/shop";
const legacy = {
  title: "Shop All Scrubs",
  metaDescription: "Browse premium medical scrubs with filters for color, size, fabric technology, and price.",
  h1: "Shop All Scrubs",
};
const replacement = {
  title: "Shop Apparel & Uniforms",
  metaDescription: "Browse DAAKYKA medical scrubs, hospital apparel, institutional linens, school uniforms and kidswear by size and category.",
  h1: "Shop All Apparel & Uniforms",
};

async function main() {
  const current = await db.seoPageRecord.findUnique({
    where: { path },
    select: { title: true, metaDescription: true, h1: true },
  });
  if (!current) throw new Error("The /shop SEO record is missing; no change made");

  const matches = (expected: typeof legacy) =>
    current.title === expected.title &&
    current.metaDescription === expected.metaDescription &&
    current.h1 === expected.h1;

  if (matches(replacement)) {
    console.log("The /shop SEO record already has the complete-catalog copy.");
    return;
  }
  if (!matches(legacy)) {
    console.log("The /shop SEO record was edited; preserving its custom copy.");
    return;
  }
  if (!process.argv.includes("--apply")) {
    console.log("The /shop SEO record matches the legacy seed; rerun with --apply to update it.");
    return;
  }

  const updated = await db.seoPageRecord.updateMany({
    where: { path, ...legacy },
    data: replacement,
  });
  if (updated.count !== 1) throw new Error("The /shop SEO record changed during update; no change made");
  console.log("Updated one legacy /shop SEO record to complete-catalog copy.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => db.$disconnect());
