import { SectionLandingPage } from "@/components/category/section-landing-page";
import { getSiteImage } from "@/lib/media/get-site-image";
import { getCategoryBySlug, getProducts } from "@/lib/products";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

const CATEGORY_SLUG = "kids-wear";

export const metadata: Metadata = {
  title: "Kids Wear",
  description:
    "Everyday kids' wear — cotton T-shirts, joggers, frocks, co-ord sets, and hoodies from DAAKYKA Apparels.",
};

export default async function KidsWearPage() {
  const category = await getCategoryBySlug(CATEGORY_SLUG);
  if (!category) notFound();

  const [products, bannerImage] = await Promise.all([
    getProducts({ categorySlug: CATEGORY_SLUG }),
    getSiteImage(`category.${CATEGORY_SLUG}`),
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
    />
  );
}
