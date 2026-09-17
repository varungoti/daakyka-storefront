import { BulkOrdersSection } from "@/components/home/bulk-orders-section";
import { FeaturedProductsGrid } from "@/components/home/featured-products-grid";
import { HeroSection } from "@/components/home/hero-section";
import { OffersStrip } from "@/components/home/offers-strip";
import { SectionFeatureBand } from "@/components/home/section-feature-band";
import { ShopByCategorySection, type ShopByCategoryTile } from "@/components/home/shop-by-category-section";
import { TestimonialsSection } from "@/components/home/testimonials-section";
import { TrustBar } from "@/components/layout/trust-bar";
import { getHeroContent, getTrustStatsContent } from "@/lib/homepage";
import { getCategoryTree, getProducts } from "@/lib/products";
import { getSeoOverrideForPath } from "@/lib/seo/records";
import { isSaleEnabled } from "@/lib/settings";
import { getTestimonials } from "@/lib/testimonials";
import { GraduationCap, HeartPulse } from "lucide-react";
import type { Metadata } from "next";

/** Lets an admin override the home page's <title>/meta description from
 * /admin/seo (SeoPageRecord, path "/") without touching code. Falls back
 * to the root layout's defaults (src/app/layout.tsx's generateMetadata())
 * when no override exists — returning {} here means "inherit". */
export async function generateMetadata(): Promise<Metadata> {
  const override = await getSeoOverrideForPath("/");
  if (!override) return {};
  return { title: override.title, description: override.metaDescription };
}

/**
 * Phase C3: the new store home — "shop now", not "brand story" (that
 * moved to /our-story). Section order follows the approved plan:
 * hero -> shop-by-category tiles -> best sellers/new arrivals grids ->
 * For Hospitals / School Uniforms feature bands -> bulk enquiry band ->
 * testimonials -> a values row.
 */
export default async function HomePage() {
  const [categoryTree, saleEnabled, heroContent, trustStats, testimonials] = await Promise.all([
    getCategoryTree(),
    isSaleEnabled(),
    getHeroContent(),
    getTrustStatsContent(),
    getTestimonials(),
  ]);

  const topLevelMenu = categoryTree.filter((category) => category.showInMenu);
  const findTopLevel = (slug: string) => topLevelMenu.find((category) => category.slug === slug);

  const hospitalsCategory = findTopLevel("for-hospitals");
  const schoolCategory = findTopLevel("school-uniforms");
  const kidsCategory = findTopLevel("kids-wear");

  const categoryTiles: ShopByCategoryTile[] = [];
  if (hospitalsCategory) {
    categoryTiles.push({
      title: hospitalsCategory.name,
      href: "/for-hospitals",
      image: hospitalsCategory.image?.url ?? null,
    });
  }
  if (schoolCategory) {
    categoryTiles.push({
      title: schoolCategory.name,
      href: "/school-uniforms",
      image: schoolCategory.image?.url ?? null,
    });
  }
  if (kidsCategory) {
    categoryTiles.push({
      title: kidsCategory.name,
      href: "/kids-wear",
      image: kidsCategory.image?.url ?? null,
    });
  }
  if (saleEnabled) {
    categoryTiles.push({ title: "Sale", href: "/sale", image: null, cta: "Shop Sale" });
  }

  const [bestSellers, newArrivalsRaw, hospitalProducts, schoolProducts] = await Promise.all([
    getProducts({ featured: true, limit: 8 }),
    getProducts({ limit: 12 }),
    hospitalsCategory ? getProducts({ categorySlug: "for-hospitals", limit: 4 }) : Promise.resolve([]),
    schoolCategory ? getProducts({ categorySlug: "school-uniforms", limit: 4 }) : Promise.resolve([]),
  ]);

  const newArrivals = newArrivalsRaw.filter((product) => product.isNew).slice(0, 8);

  return (
    <>
      <HeroSection content={heroContent} trustStats={trustStats.stats} />
      <OffersStrip />
      <ShopByCategorySection categories={categoryTiles} />
      <FeaturedProductsGrid eyebrow="Curated For You" title="Best Sellers" products={bestSellers} />
      {newArrivals.length > 0 && (
        <FeaturedProductsGrid
          eyebrow="Just In"
          title="New Arrivals"
          products={newArrivals}
          className="bg-background py-12 md:py-16"
        />
      )}
      <SectionFeatureBand
        icon={HeartPulse}
        eyebrow="For Hospitals"
        title="Scrubs, Gowns & Hospital Linens"
        description="Hygienic, durable apparel and linens built for demanding healthcare environments."
        products={hospitalProducts}
        browseHref="/for-hospitals"
        browseLabel="Browse Hospital Range"
      />
      <SectionFeatureBand
        icon={GraduationCap}
        eyebrow="School Uniforms"
        title="Uniforms Built for the Classroom and Beyond"
        description="Shirts, tunics, trousers, blazers, and sportswear reflecting institutional pride."
        products={schoolProducts}
        browseHref="/school-uniforms"
        browseLabel="Browse School Range"
        variant="alt"
      />
      <BulkOrdersSection />
      <TestimonialsSection testimonials={testimonials} />
      <TrustBar />
    </>
  );
}
