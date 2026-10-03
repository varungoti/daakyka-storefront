import { boundedCache } from "@/lib/cache/bounded-cache";
import { kidsConcepts } from "@/data/catalog/kids-concepts";
import { db } from "@/lib/db";
import { PRODUCTS_CACHE_TAG } from "@/lib/products";

export interface KidsConceptPreview {
  slug: string;
  name: string;
  color: string;
  images: { url: string; alt: string }[];
}

async function queryKidsConceptGallery(): Promise<KidsConceptPreview[]> {
  const rows = await db.product.findMany({
    where: {
      slug: { in: kidsConcepts.map((concept) => concept.slug) },
      status: "DRAFT",
      tags: { has: "concept-pending-verification" },
      category: { active: true, section: "KIDS" },
    },
    include: {
      images: { orderBy: { sortOrder: "asc" }, include: { media: true } },
    },
  });
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return kidsConcepts.flatMap((concept) => {
    const row = bySlug.get(concept.slug);
    if (!row || row.images.length < 3) return [];
    const images = row.images.slice(0, 3);
    if (images.some((image) => image.media.source !== "AI" || image.color !== concept.color)) return [];
    return [{
      slug: concept.slug,
      name: concept.name,
      color: concept.color,
      images: images.map((image) => ({ url: image.media.url, alt: image.alt ?? image.media.alt ?? concept.name })),
    }];
  });
}

const cachedKidsConceptGallery = boundedCache(queryKidsConceptGallery, ["kids-concept-gallery-v1"], [PRODUCTS_CACHE_TAG]);

export async function getKidsConceptGallery(): Promise<KidsConceptPreview[]> {
  try { return await cachedKidsConceptGallery(); }
  catch { return queryKidsConceptGallery(); }
}
