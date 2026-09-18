import { SectionLandingPage } from "@/components/category/section-landing-page";
import { getSiteImage } from "@/lib/media/get-site-image";
import { getCategoryBySlug, getProducts } from "@/lib/products";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

const CATEGORY_SLUG = "school-uniforms";

export const metadata: Metadata = {
  title: "School Uniforms",
  description:
    "Shirts, tunics, trousers, skirts, pinafores, made-to-measure blazers, sweaters, and sportswear for schools — by DAAKYKA Apparels, Pan India delivery.",
};

export default async function SchoolUniformsPage() {
  const category = await getCategoryBySlug(CATEGORY_SLUG);
  if (!category) notFound();

  const [products, bannerImage] = await Promise.all([
    getProducts({ categorySlug: CATEGORY_SLUG }),
    getSiteImage(`category.${CATEGORY_SLUG}`),
  ]);

  return (
    <SectionLandingPage
      eyebrow="School Uniforms"
      title="School Uniforms"
      description="Smart, comfortable uniforms — shirts, tunics, trousers, skirts, pinafores, made-to-measure blazers, sweaters, and sportswear — reflecting institutional pride."
      category={category}
      products={products}
      bulkNote="School-wide uniform programs with consistent sizing, made-to-measure blazers, and bulk pricing for institutions of any size."
      bannerImage={bannerImage}
    />
  );
}
