import { BespokeSection } from "@/components/home/bespoke-section";
import { ProductGrid } from "@/components/shop/product-grid";
import { getProductsByCategory } from "@/lib/products";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Bespoke Collection",
  description:
    "Luxury medical apparel crafted for refinement, performance and prestige.",
};

export default async function BespokePage() {
  const products = await getProductsByCategory("bespoke");

  return (
    <>
      <BespokeSection />
      <section className="py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <ProductGrid
            products={products}
            totalCount={products.length}
          />
        </div>
      </section>
    </>
  );
}
