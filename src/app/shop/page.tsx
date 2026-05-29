import { ShopPageContent } from "@/components/shop/shop-page-content";
import { getProducts } from "@/lib/products";
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
  const [products, testimonials] = await Promise.all([getProducts(), getTestimonials()]);

  return (
    <ShopPageContent
      products={products}
      testimonials={testimonials}
      initialCategory={params.category}
      initialQuery={params.q}
    />
  );
}
