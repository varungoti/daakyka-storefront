import { ShopPageContent } from "@/components/shop/shop-page-content";
import { getCategoryTree, getProducts } from "@/lib/products";
import { getSeoOverrideForPath } from "@/lib/seo/records";
import { isPageEnabled } from "@/lib/settings";
import { getTestimonials } from "@/lib/testimonials";
import type { Metadata } from "next";

const DEFAULT_METADATA = {
  title: "Shop All Scrubs",
  description:
    "Browse premium medical scrubs with advanced filters for color, size, fabric technology, and price.",
};

/** Same admin-override mechanism as src/app/page.tsx's generateMetadata()
 * — falls back to the static defaults above when no SeoPageRecord exists
 * for "/shop". */
export async function generateMetadata(): Promise<Metadata> {
  const override = await getSeoOverrideForPath("/shop");
  return {
    title: override?.title ?? DEFAULT_METADATA.title,
    description: override?.metaDescription ?? DEFAULT_METADATA.description,
  };
}

interface ShopPageProps {
  searchParams: Promise<{ category?: string; q?: string }>;
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  const params = await searchParams;
  const [products, categories, testimonials, fabricTechEnabled, mixMatchEnabled] =
    await Promise.all([
      getProducts(),
      getCategoryTree(),
      getTestimonials(),
      isPageEnabled("fabricTech"),
      isPageEnabled("mixMatch"),
    ]);

  return (
    <ShopPageContent
      products={products}
      categories={categories}
      testimonials={testimonials}
      initialCategory={params.category}
      initialQuery={params.q}
      fabricTechEnabled={fabricTechEnabled}
      mixMatchEnabled={mixMatchEnabled}
    />
  );
}
