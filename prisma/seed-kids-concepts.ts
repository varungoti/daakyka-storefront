import "dotenv/config";
import { pathToFileURL } from "node:url";
import { kidsConcepts } from "../src/data/catalog/kids-concepts";
import { createPrismaClient } from "../src/lib/create-prisma-client";
import type { PrismaClient } from "../src/generated/prisma/client";

export const KIDS_CONCEPT_SEED_MARKER_KEY = "seed.kidsConcepts20261003";

/** Create-only, once per database. Never resurrect an admin-deleted concept. */
export async function seedKidsConcepts(db: PrismaClient): Promise<number> {
  if (await db.siteSetting.findUnique({ where: { key: KIDS_CONCEPT_SEED_MARKER_KEY } })) return 0;
  const categorySlugs = [...new Set(kidsConcepts.map((concept) => concept.categorySlug))];
  const categories = await db.category.findMany({
    where: { slug: { in: categorySlugs }, section: "KIDS" },
    select: { id: true, slug: true },
  });
  if (categories.length !== categorySlugs.length) {
    // prisma/seed.ts also runs before catalog seeding on fresh databases.
    // Wait for categories rather than writing incomplete product records.
    console.log("[seed] Kids concept categories are not seeded yet; skipping concepts.");
    return 0;
  }
  const ids = new Map(categories.map((category) => [category.slug, category.id]));
  let created = 0;
  for (const concept of kidsConcepts) {
    const existing = await db.product.findUnique({ where: { slug: concept.slug }, select: { id: true } });
    if (existing) continue;
    await db.product.create({
      data: {
        slug: concept.slug,
        name: concept.name,
        shortDescription: `Design concept in ${concept.color}; physical product details pending verification.`,
        description: `${concept.design} AI concept artwork is provided for design review only. Fabric, measurements, size availability, price and inventory have not been verified.`,
        categoryId: ids.get(concept.categorySlug)!,
        status: "DRAFT",
        featured: false,
        isNew: false,
        price: 0,
        gender: concept.gender,
        tags: ["kids", "concept-pending-verification"],
      },
    });
    created++;
  }
  await db.siteSetting.create({
    data: { key: KIDS_CONCEPT_SEED_MARKER_KEY, value: new Date().toISOString() },
  });
  return created;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createPrismaClient();
  seedKidsConcepts(db)
    .then((count) => console.log(`[seed] Created ${count} Kids Wear concept drafts.`))
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => db.$disconnect());
}
