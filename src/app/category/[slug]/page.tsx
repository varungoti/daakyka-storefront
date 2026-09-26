import { ShopPageContent } from "@/components/shop/shop-page-content";
import { getSiteImage } from "@/lib/media/get-site-image";
import { resolveCategoryHeadingImage } from "@/lib/media/category-heading-image";
import { getCategoryBySlug, getProducts } from "@/lib/products";
import { canonicalPath } from "@/lib/seo/canonical";
import { getTestimonials } from "@/lib/testimonials";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string; q?: string; sort?: string }>;
}

/**
 * Phase C3: the generic category listing page — replaces the old
 * placeholder `collections/[handle]` pattern for real DB categories
 * (that route stays in place for its own hardcoded collectionPages
 * entries — best-sellers, stretch-collection, hospital-teams, bespoke).
 * Reuses the same filterable shop grid as /shop, scoped to this category
 * (+ its descendants) via getProducts({ categorySlug }).
 */
export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "Category Not Found" };
  return {
    title: category.name,
    description:
      category.description ?? `Shop ${category.name} from DAAKYKA Apparels — Pan India delivery.`,
    alternates: { canonical: canonicalPath(`/category/${slug}`) },
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();

  const search = await searchParams;
  const [products, testimonials, slotImage] = await Promise.all([
    getProducts({ categorySlug: slug }),
    getTestimonials(),
    getSiteImage(`category.${slug}`),
  ]);

  // F-364: fall back to the category editor's own Category.image when the
  // "category.<slug>" Site Images slot is empty — see that helper's doc
  // comment.
  const headingImage = resolveCategoryHeadingImage(slotImage, category);

  return (
    <ShopPageContent
      products={products}
      categories={category.children}
      testimonials={testimonials}
      initialCategory={search.category}
      initialQuery={search.q}
      showExtras={false}
      heading={{
        eyebrow: category.section,
        title: category.name,
        description:
          category.description ?? `Browse ${category.name.toLowerCase()} from DAAKYKA Apparels.`,
        breadcrumbLabel: category.name,
      }}
      headingImage={headingImage}
    />
  );
}
