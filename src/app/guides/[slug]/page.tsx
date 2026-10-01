import { SeoLandingLayout } from "@/components/seo/seo-landing-layout";
import {
  resolveLegacyGuidePath,
  seoLandingPages,
  type SeoLandingPageConfig,
} from "@/data/seo-landing-pages";
import { getBestSellers, getProductsByCategory } from "@/lib/products";
import { canonicalPath } from "@/lib/seo/canonical";
import { baseOpenGraph } from "@/lib/seo/json-ld";
import { isPageEnabled } from "@/lib/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Some SEO landing pages link to /fabric-technology or /mix-and-match —
// both hideable via /admin/site-controls. When disabled, point those links
// at /shop instead of a URL that would 404.
function resolveHref(
  href: string,
  flags: { fabricTechEnabled: boolean; mixMatchEnabled: boolean },
): string {
  if (href.startsWith("/fabric-technology") && !flags.fabricTechEnabled) return "/shop";
  if (href.startsWith("/mix-and-match") && !flags.mixMatchEnabled) return "/shop";
  return href;
}

function resolvePageLinks(
  page: SeoLandingPageConfig,
  flags: { fabricTechEnabled: boolean; mixMatchEnabled: boolean },
): SeoLandingPageConfig {
  // F-048: link straight to a guide's final /guides/<slug> URL instead of its
  // legacy path (which 308s there) — that's a rename, not a change of
  // destination, so the label stays; only a flag-disabled page swaps it.
  const linkedShopHref = resolveLegacyGuidePath(page.shopHref);
  const linkedSecondaryHref = page.secondaryHref
    ? resolveLegacyGuidePath(page.secondaryHref)
    : page.secondaryHref;
  const shopHref = resolveHref(linkedShopHref, flags);
  const secondaryHref = linkedSecondaryHref ? resolveHref(linkedSecondaryHref, flags) : linkedSecondaryHref;

  return {
    ...page,
    shopHref,
    shopLabel: shopHref === linkedShopHref ? page.shopLabel : "Shop Now",
    secondaryHref,
    secondaryLabel:
      secondaryHref === linkedSecondaryHref ? page.secondaryLabel : "Shop Now",
  };
}

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
  return {
    title: page.title,
    description: page.metaDescription,
    alternates: { canonical: canonicalPath(`/guides/${slug}`) },
    openGraph: baseOpenGraph(`/guides/${slug}`),
  };
}

export default async function SeoGuidePage({ params }: PageProps) {
  const { slug } = await params;
  const page = seoLandingPages.find((p) => p.slug === slug);
  if (!page) notFound();

  const [products, fabricTechEnabled, mixMatchEnabled] = await Promise.all([
    page.productCategory
      ? getProductsByCategory(page.productCategory).then((list) => list.slice(0, 4))
      : getBestSellers().then((list) => list.slice(0, 4)),
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
  ]);

  const resolvedPage = resolvePageLinks(page, { fabricTechEnabled, mixMatchEnabled });

  return <SeoLandingLayout page={resolvedPage} products={products} />;
}
