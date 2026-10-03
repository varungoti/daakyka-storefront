import { FEATURED_PRODUCT_SLUGS } from "../src/data/catalog/featured-products";
import type { PrismaClient } from "../src/generated/prisma/client";

export const MERCHANDISING_MARKER_KEY = "seed.kidsFirstMerchandising20261003";
export const KIDS_FIRST_SEO_MARKER_KEY = "seed.kidsFirstSeo20261003";

const OLD_HOME_SEO = {
  title: "DAAKYKA Apparels | Quality Uniforms & Linens for Pan India",
  metaDescription: "Expertly designed medical scrubs and institutional uniforms. Pan India delivery by Babaji Enterprises.",
};
export const KIDS_FIRST_HOME_SEO = {
  title: "DAAKYKA Apparels | Kids Wear, Hospital & School Uniforms",
  metaDescription: "Shop kids wear, hospital apparel and linens, and school uniforms. Pan India delivery by Babaji Enterprises.",
};
const OLD_SHOP_SEO = {
  title: "Shop Apparel & Uniforms",
  metaDescription: "Browse DAAKYKA medical scrubs, hospital apparel, institutional linens, school uniforms and kidswear by size and category.",
};
export const KIDS_FIRST_SHOP_SEO = {
  title: "Shop Apparel & Uniforms",
  metaDescription: "Browse DAAKYKA kidswear, hospital scrubs and apparel, institutional linens, and school uniforms by size and category.",
};

const HERO_ORDER = ["kids-wear", "hospital-scrubs", "school-uniforms"];
const OLD_HERO_DESCRIPTION = "Hospital linens, medical scrubs, school uniforms, and corporate wear by Babaji Enterprises — Hyderabad-based, Pan India delivery.";
const NEW_HERO_DESCRIPTION = "Kids wear, medical scrubs, hospital linens, and school uniforms by Babaji Enterprises — Hyderabad-based, Pan India delivery.";

/** One-time update of the already seeded live catalog; no listing is published here. */
export async function applyKidsFirstMerchandising(db: PrismaClient) {
  if (await db.siteSetting.findUnique({ where: { key: MERCHANDISING_MARKER_KEY } })) return null;

  const hero = await db.homepageSection.findUnique({ where: { key: "hero-slides" } });
  let reorderedSlides = 0;
  let reorderedCategories = 0;
  let correctedHeroFallback = false;
  if (hero) {
    const content = JSON.parse(hero.content) as { slides?: { id?: string }[]; [key: string]: unknown };
    if (!Array.isArray(content.slides)) throw new Error("Cannot reorder invalid hero slides");
    const ordered = [...content.slides].sort((a, b) => {
      const rank = (id?: string) => {
        const index = HERO_ORDER.indexOf(id ?? "");
        return index < 0 ? HERO_ORDER.length : index;
      };
      return rank(a.id) - rank(b.id);
    });
    if (ordered.some((slide, index) => slide.id !== content.slides?.[index]?.id)) {
      await db.homepageSection.update({
        where: { id: hero.id },
        data: { content: JSON.stringify({ ...content, slides: ordered }) },
      });
      reorderedSlides = ordered.length;
    }
  }

  const fallbackHero = await db.homepageSection.findUnique({ where: { key: "hero" } });
  if (fallbackHero) {
    const content = JSON.parse(fallbackHero.content) as Record<string, unknown>;
    if (content.description === OLD_HERO_DESCRIPTION && content.primaryCta === "Shop All Scrubs") {
      await db.homepageSection.update({
        where: { id: fallbackHero.id },
        data: { content: JSON.stringify({ ...content, description: NEW_HERO_DESCRIPTION, primaryCta: "Shop Kids Wear" }) },
      });
      correctedHeroFallback = true;
    }
  }

  for (const [slug, section, sortOrder] of [
    ["kids-wear", "KIDS", 10],
    ["for-hospitals", "HOSPITAL", 20],
    ["school-uniforms", "SCHOOL", 30],
  ] as const) {
    const result = await db.category.updateMany({
      where: { slug, section, parentId: null, sortOrder: { not: sortOrder } },
      data: { sortOrder },
    });
    reorderedCategories += result.count;
  }

  // Only existing, active, photo-backed listings can be featured. Missing
  // product or media rows stay untouched and can be reviewed in admin.
  const result = await db.product.updateMany({
    where: {
      slug: { in: [...FEATURED_PRODUCT_SLUGS] },
      status: "ACTIVE",
      category: { active: true },
      images: { some: {} },
      featured: false,
    },
    data: { featured: true },
  });

  await db.siteSetting.create({
    data: { key: MERCHANDISING_MARKER_KEY, value: new Date().toISOString() },
  });
  return { reorderedSlides, reorderedCategories, correctedHeroFallback, newlyFeatured: result.count };
}

/** Replace only exact legacy seed metadata, never an admin-authored override. */
export async function applyKidsFirstSeoCorrection(db: PrismaClient): Promise<number | null> {
  if (await db.siteSetting.findUnique({ where: { key: KIDS_FIRST_SEO_MARKER_KEY } })) return null;
  const home = await db.seoPageRecord.updateMany({
    where: { path: "/", ...OLD_HOME_SEO },
    data: KIDS_FIRST_HOME_SEO,
  });
  const shop = await db.seoPageRecord.updateMany({
    where: { path: "/shop", ...OLD_SHOP_SEO },
    data: KIDS_FIRST_SHOP_SEO,
  });
  await db.siteSetting.create({
    data: { key: KIDS_FIRST_SEO_MARKER_KEY, value: new Date().toISOString() },
  });
  return home.count + shop.count;
}
