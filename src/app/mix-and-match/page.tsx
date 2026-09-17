import { MixMatchBuilder } from "@/components/mix-match/mix-match-builder";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { getProducts } from "@/lib/products";
import { isPageEnabled } from "@/lib/settings";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mix & Match",
  description: "Build your perfect scrub set with our 3D visual configurator.",
};

export default async function MixAndMatchPage() {
  if (!(await isPageEnabled("mixMatch"))) {
    notFound();
  }

  const products = await getProducts();

  return (
    <>
      <PageHeroBand className="py-14 md:py-16">
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">
            3D Visualizer
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-ink md:text-5xl">
            Build Your Perfect Scrub Set
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted">
            Drag to rotate the preview, pick styles and fabrics, personalize with embroidery, and add
            your complete set to cart.{" "}
            <a href="/mix-and-match/studio" className="font-semibold text-brand hover:underline">
              Try the Virtual Try-On Studio →
            </a>
          </p>
        </div>
      </PageHeroBand>

      <PageContentSection variant="mix" className="py-12 md:py-16">
        <MixMatchBuilder products={products} />
      </PageContentSection>
    </>
  );
}
