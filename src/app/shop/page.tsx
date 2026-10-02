import { ShopPageContent } from "@/components/shop/shop-page-content";
import { getCategoryTree, getProducts } from "@/lib/products";
import { toShopCardProduct } from "@/lib/products/card-product";
import { canonicalPath } from "@/lib/seo/canonical";
import { baseOpenGraph } from "@/lib/seo/json-ld";
import { getSeoOverrideForPath } from "@/lib/seo/records";
import { resolveShopMetadata } from "@/lib/seo/shop-metadata";
import { getSetting, isPageEnabled } from "@/lib/settings";
import { getTestimonials } from "@/lib/testimonials";
import type { Metadata } from "next";

/** Same admin-override mechanism as src/app/page.tsx's generateMetadata()
 * — falls back to complete-catalog defaults when no SeoPageRecord exists
 * for "/shop". */
export async function generateMetadata(): Promise<Metadata> {
  const override = await getSeoOverrideForPath("/shop");
  const resolved = resolveShopMetadata(override);
  return {
    title: resolved.title,
    description: resolved.description,
    // Canonical is always the bare /shop path, regardless of ?category=/?q=
    // filter query params — those are the same content, not distinct pages.
    alternates: { canonical: canonicalPath("/shop") },
    openGraph: baseOpenGraph("/shop"),
  };
}

// F-018: no `searchParams` prop here — reading it opts the route into
// per-request rendering (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md),
// which made /shop a no-store function run on every view. ShopPageContent reads
// ?category=/?q=/facets itself from the URL after hydration (it already did, for
// everything but those two), so this prerenders — every read below is a tagged
// unstable_cache, and an admin catalog save or a stock change revalidates it.
export default async function ShopPage() {
  const [products, categories, testimonials, fabricTechEnabled, mixMatchEnabled, returnWindowDays] =
    await Promise.all([
      getProducts(),
      getCategoryTree(),
      getTestimonials(),
      isPageEnabled("fabricTech"),
      isPageEnabled("mixMatch"),
      // F-008: forwarded to TrustBar — see ShopPageContent's doc comment
      // on this prop.
      getSetting("returns.windowDays"),
    ]);

  return (
    <ShopPageContent
      products={products.map(toShopCardProduct)}
      categories={categories}
      testimonials={testimonials}
      fabricTechEnabled={fabricTechEnabled}
      mixMatchEnabled={mixMatchEnabled}
      returnWindowDays={returnWindowDays}
    />
  );
}
