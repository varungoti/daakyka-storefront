import { SeoLandingLayout } from "@/components/seo/seo-landing-layout";
import { seoLandingPages } from "@/data/seo-landing-pages";
import { getBestSellers, getProductsByCategory } from "@/lib/products";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return seoLandingPages.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = seoLandingPages.find((p) => p.slug === slug);
  if (!page) return { title: "Not Found" };
  return { title: page.title, description: page.metaDescription };
}

export default async function SeoGuidePage({ params }: PageProps) {
  const { slug } = await params;
  const page = seoLandingPages.find((p) => p.slug === slug);
  if (!page) notFound();

  const products = page.productCategory
    ? (await getProductsByCategory(page.productCategory)).slice(0, 4)
    : (await getBestSellers()).slice(0, 4);

  return <SeoLandingLayout page={page} products={products} />;
}
