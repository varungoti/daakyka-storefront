import { collectionPages, getCollection } from "@/data/seo-landing-pages";
import { Button } from "@/components/ui/button";
import { ProductCard } from "@/components/ui/product-card";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { getBestSellers, getProducts } from "@/lib/products";
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

export default async function CollectionPage({ params }: PageProps) {
  const { handle } = await params;
  const collection = getCollection(handle);
  if (!collection) notFound();

  if ("shopHref" in collection && collection.shopHref && handle !== "best-sellers") {
    return (
      <>
        <PageHeroBand innerClassName="max-w-3xl text-center">
          <SectionHeading
            title={collection.title}
            description={collection.description}
            align="center"
            titleAs="h1"
          />
          <Link href={collection.shopHref} className="mt-8 inline-block">
            <Button size="lg">Continue to {collection.title}</Button>
          </Link>
        </PageHeroBand>
      </>
    );
  }

  const products =
    handle === "best-sellers" ? await getBestSellers() : (await getProducts()).slice(0, 8);

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
