import { MixMatchStudioBuilder } from "@/components/mix-match/mix-match-studio-builder";
import { getProducts } from "@/lib/products";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Mix & Match Studio | Virtual Try-On",
  description:
    "MediaPipe AR virtual try-on for DAAKYKA scrubs. Test every top, bottom, and color on preset avatars.",
  robots: { index: false, follow: false },
};

export default async function MixMatchStudioPage() {
  const products = await getProducts();
  const studioEnabled = process.env.NEXT_PUBLIC_OUTFIT_STUDIO !== "0";

  if (!studioEnabled) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold text-ink">Studio unavailable</h1>
        <p className="mt-4 text-muted">Enable NEXT_PUBLIC_OUTFIT_STUDIO to access virtual try-on.</p>
        <Link href="/mix-and-match" className="mt-6 inline-block text-brand hover:underline">
          Back to Mix & Match
        </Link>
      </section>
    );
  }

  return (
    <>
      <section className="border-b border-border bg-[linear-gradient(180deg,#ebe2ff_0%,#f8f5ff_45%,#ffffff_100%)] py-12 md:py-14">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">Beta · Noindex</p>
              <h1 className="mt-2 font-display text-4xl font-extrabold text-ink md:text-5xl">
                Virtual Try-On Studio
              </h1>
              <p className="mt-3 max-w-2xl text-muted">
                Production test bed for MediaPipe AR try-on. All Shopify catalog products sync here
                automatically.
              </p>
            </div>
            <Link
              href="/mix-and-match"
              className="rounded-full border border-brand/30 px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5"
            >
              Classic builder
            </Link>
          </div>
        </div>
      </section>

      <section className="bg-lavender/15 py-12 md:py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <MixMatchStudioBuilder products={products} />
        </div>
      </section>
    </>
  );
}
