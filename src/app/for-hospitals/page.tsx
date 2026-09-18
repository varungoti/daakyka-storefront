import { SectionLandingPage } from "@/components/category/section-landing-page";
import { getSiteImage } from "@/lib/media/get-site-image";
import { getCategoryBySlug, getProducts } from "@/lib/products";
import { canonicalPath } from "@/lib/seo/canonical";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

const CATEGORY_SLUG = "for-hospitals";

export const metadata: Metadata = {
  title: "For Hospitals",
  description:
    "Scrubs, lab coats, surgical gowns, patient gowns, staff uniforms, and hospital linens by DAAKYKA Apparels — Pan India delivery and institutional pricing.",
  alternates: { canonical: canonicalPath("/for-hospitals") },
};

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
