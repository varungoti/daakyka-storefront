import { MixMatchStudioBuilder } from "@/components/mix-match/mix-match-studio-builder";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { getProducts } from "@/lib/products";
import { isPageEnabled } from "@/lib/settings";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Mix & Match Studio | Virtual Try-On",
  description:
    "MediaPipe AR virtual try-on for DAAKYKA scrubs. Test every top, bottom, and color on preset avatars.",
  robots: { index: false, follow: false },
};

export default async function MixMatchStudioPage() {
  if (!(await isPageEnabled("mixMatch"))) {
    notFound();
  }

  const products = await getProducts();

  return (
    <>
      <PageHeroBand className="py-12 md:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">Beta · Noindex</p>
            <h1 className="mt-2 font-display text-4xl font-bold text-ink md:text-5xl">
              Virtual Try-On Studio
            </h1>
            <p className="mt-3 max-w-2xl text-muted">
              Production test bed for MediaPipe AR try-on. All Shopify catalog products sync here
              automatically.
            </p>
          </div>
          <Link
            href="/mix-and-match"
            className="rounded-full border border-border bg-surface-muted px-4 py-2 text-sm font-semibold text-brand transition hover:border-brand/40 hover:bg-lilac/40"
          >
            Classic builder
          </Link>
        </div>
      </PageHeroBand>

      <PageContentSection variant="mix" className="py-12 md:py-16">
        <MixMatchStudioBuilder products={products} />
      </PageContentSection>
    </>
  );
}
