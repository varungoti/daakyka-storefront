import { ShopPageContent } from "@/components/shop/shop-page-content";
import { getCategoryTree, getProducts } from "@/lib/products";
import { isPageEnabled } from "@/lib/settings";
import { getTestimonials } from "@/lib/testimonials";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shop All Scrubs",
  description:
    "Browse premium medical scrubs with advanced filters for color, size, fabric technology, and price.",
};

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
