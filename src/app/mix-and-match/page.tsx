import { MixMatchBuilder } from "@/components/mix-match/mix-match-builder";
import { getProducts } from "@/lib/products";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mix & Match",
  description: "Build your perfect scrub set with our 3D visual configurator.",
};

export default async function MixAndMatchPage() {
  const products = await getProducts();

  return (
    <>
      <section className="border-b border-border bg-[linear-gradient(180deg,#f3ecff_0%,#ffffff_100%)] py-14 md:py-16">
        <div className="mx-auto max-w-7xl px-4 text-center lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">
            3D Visualizer
          </p>
          <h1 className="mt-3 font-display text-4xl font-extrabold text-ink md:text-5xl">
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
      </section>

      <section className="bg-lavender/20 py-12 md:py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <MixMatchBuilder products={products} />
        </div>
      </section>
    </>
  );
}
