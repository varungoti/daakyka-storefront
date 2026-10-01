import { ShopPageContent } from "@/components/shop/shop-page-content";
import { getCategoryTree, getProducts } from "@/lib/products";
import { canonicalPath } from "@/lib/seo/canonical";
import { baseOpenGraph } from "@/lib/seo/json-ld";
import { getSeoOverrideForPath } from "@/lib/seo/records";
import { resolveShopMetadata } from "@/lib/seo/shop-metadata";
import { getSetting, isPageEnabled } from "@/lib/settings";
import { getTestimonials } from "@/lib/testimonials";
import type { Metadata } from "next";

/** Same admin-override mechanism as src/app/page.tsx's generateMetadata()
 * — falls back to complete-catalog defaults when no SeoPageRecord exists
 * for "/shop". */
export async function generateMetadata(): Promise<Metadata> {
  const override = await getSeoOverrideForPath("/shop");
  const resolved = resolveShopMetadata(override);
  return {
    title: resolved.title,
    description: resolved.description,
    // Canonical is always the bare /shop path, regardless of ?category=/?q=
    // filter query params — those are the same content, not distinct pages.
    alternates: { canonical: canonicalPath("/shop") },
    openGraph: baseOpenGraph("/shop"),
  };
}

interface ShopPageProps {
  searchParams: Promise<{ category?: string; q?: string }>;
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const params = await searchParams;
  const [products, categories, testimonials, fabricTechEnabled, mixMatchEnabled, returnWindowDays] =
    await Promise.all([
      getProducts(),
      getCategoryTree(),
      getTestimonials(),
      isPageEnabled("fabricTech"),
      isPageEnabled("mixMatch"),
      // F-008: forwarded to TrustBar — see ShopPageContent's doc comment
      // on this prop.
      getSetting("returns.windowDays"),
    ]);

  return (
    <ShopPageContent
      products={products}
      categories={categories}
      testimonials={testimonials}
      initialQuery={params.q}
      fabricTechEnabled={fabricTechEnabled}
      mixMatchEnabled={mixMatchEnabled}
      returnWindowDays={returnWindowDays}
    />
  );
}
