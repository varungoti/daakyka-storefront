import { SectionLandingPage } from "@/components/category/section-landing-page";
import { getSiteImage } from "@/lib/media/get-site-image";
import { getCategoryBySlug, getProducts } from "@/lib/products";
import { canonicalPath } from "@/lib/seo/canonical";
import { getCategorySeoOverride, resolveCategoryMetadata } from "@/lib/seo/category-seo";
import { baseOpenGraph } from "@/lib/seo/json-ld";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

const CATEGORY_SLUG = "for-hospitals";

const FALLBACK_METADATA = {
  title: "For Hospitals",
  description:
    "Scrubs, lab coats, surgical gowns, patient gowns, staff uniforms, and hospital linens by DAAKYKA Apparels — Pan India delivery and institutional pricing.",
};

// release-hardening F-098: this used to be a static `metadata` export, so the
// admin's "SEO title"/"SEO description" on the For Hospitals category were
// never read — they win over FALLBACK_METADATA now. F-151: og:url, which no
// page set.
export async function generateMetadata(): Promise<Metadata> {
  return {
    ...resolveCategoryMetadata(FALLBACK_METADATA, await getCategorySeoOverride(CATEGORY_SLUG)),
    alternates: { canonical: canonicalPath("/for-hospitals") },
    openGraph: baseOpenGraph("/for-hospitals"),
  };
}

export default async function ForHospitalsPage() {
  const category = await getCategoryBySlug(CATEGORY_SLUG);
  if (!category) notFound();

  const [products, bannerImage] = await Promise.all([
    getProducts({ categorySlug: CATEGORY_SLUG }),
    getSiteImage(`category.${CATEGORY_SLUG}`),
  ]);

  return (
    <SectionLandingPage
      eyebrow="For Hospitals"
      title="For Hospitals"
      description="Hygienic, durable scrubs, gowns, staff uniforms, and hospital linens designed for demanding healthcare environments — with department-wise color standardization and logo embroidery available."
      category={category}
      products={products}
      bulkNote="Department-wise uniform planning, logo embroidery, and bulk pricing for hospitals, clinics, and nursing colleges of any size."
      bannerImage={bannerImage}
    />
  );
}
