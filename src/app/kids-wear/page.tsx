import { SectionLandingPage } from "@/components/category/section-landing-page";
import { KidsConceptGallery } from "@/components/category/kids-concept-gallery";
import { getKidsConceptGallery } from "@/lib/catalog/kids-concept-gallery";
import { getSiteImage } from "@/lib/media/get-site-image";
import { getCategoryBySlug, getProducts } from "@/lib/products";
import { canonicalPath } from "@/lib/seo/canonical";
import { getCategorySeoOverride, resolveCategoryMetadata } from "@/lib/seo/category-seo";
import { baseOpenGraph } from "@/lib/seo/json-ld";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

const CATEGORY_SLUG = "kids-wear";

const FALLBACK_METADATA = {
  title: "Kids Wear",
  description:
    "Everyday kids' wear — cotton T-shirts, joggers, frocks, co-ord sets, and hoodies from DAAKYKA Apparels.",
};

// release-hardening F-098/F-151: see src/app/for-hospitals/page.tsx.
export async function generateMetadata(): Promise<Metadata> {
  return {
    ...resolveCategoryMetadata(FALLBACK_METADATA, await getCategorySeoOverride(CATEGORY_SLUG)),
    alternates: { canonical: canonicalPath("/kids-wear") },
    openGraph: baseOpenGraph("/kids-wear"),
  };
}

export default async function KidsWearPage() {
  const category = await getCategoryBySlug(CATEGORY_SLUG);
  if (!category) notFound();

  const [products, bannerImage, concepts] = await Promise.all([
    getProducts({ categorySlug: CATEGORY_SLUG }),
    getSiteImage(`category.${CATEGORY_SLUG}`),
    getKidsConceptGallery(),
  ]);

  return (
    <SectionLandingPage
      eyebrow="Kids Wear"
      title="Kids Wear"
      description="Comfortable, everyday wear for kids — T-shirts, joggers, frocks, co-ord sets, and hoodies."
      category={category}
      products={products}
      bulkNote="Outfitting a daycare, camp, or kids' program? We support bulk orders for kids' wear too."
      bannerImage={bannerImage}
    >
      <KidsConceptGallery concepts={concepts} />
    </SectionLandingPage>
  );
}
