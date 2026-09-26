import { collectionPages, getCollection } from "@/data/seo-landing-pages";
import { ProductCard } from "@/components/ui/product-card";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { getBestSellers } from "@/lib/products";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ handle: string }>;
}

export function generateStaticParams() {
  return collectionPages.map((c) => ({ handle: c.handle }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { handle } = await params;
  const collection = getCollection(handle);
  if (!collection) return { title: "Collection Not Found" };
  return { title: collection.title, description: collection.description };
}

/**
 * release-hardening audit F-020: `collectionPages` used to have three more
 * entries (stretch-collection, hospital-teams, bespoke) that only ever hit
 * a "Continue to X" interstitial branch here — zero product cards, just a
 * link onward to where the real content actually lived. Those entries are
 * gone (their old /collections/<handle> URLs now redirect straight there —
 * see next.config.ts), so "best-sellers" (renamed "Featured" — it's the
 * admin's `featured` flag, not real sales data) is the only collection
 * left, and it always renders a real product grid. The interstitial branch
 * this page used to have for the other three is gone with them.
 */
export default async function CollectionPage({ params }: PageProps) {
  const { handle } = await params;
  const collection = getCollection(handle);
  if (!collection) notFound();

  const products = await getBestSellers();

  return (
    <>
      <PageHeroBand>
        <SectionHeading
          title={collection.title}
          description={collection.description}
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link href="/shop" className="text-sm font-semibold text-brand hover:underline">
            View all products →
          </Link>
        </div>
      </PageContentSection>
    </>
  );
}
