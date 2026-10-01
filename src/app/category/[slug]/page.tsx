import { ShopPageContent } from "@/components/shop/shop-page-content";
import { getSiteImage } from "@/lib/media/get-site-image";
import { resolveCategoryHeadingImage } from "@/lib/media/category-heading-image";
import { getCategoryBySlug, getProducts } from "@/lib/products";
import { getCategorySeoOverride, resolveCategoryMetadata } from "@/lib/seo/category-seo";
import { canonicalPath, sectionLandingPath } from "@/lib/seo/canonical";
import { baseOpenGraph } from "@/lib/seo/json-ld";
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
  if (!category) {
    // release-hardening F-012: Next already tags a notFound() render
    // `noindex` on its own — `follow: true` keeps that from also fighting
    // the root layout's `index, follow`. No `alternates` here (rather than
    // one pointing at the homepage) now that the root layout no longer
    // sets a canonical every page inherits by default (see F-147).
    return { title: "Category Not Found", robots: { index: false, follow: true } };
  }

  // release-hardening F-098: prefer the admin's "SEO title"/"SEO
  // description" (category-form.tsx) over the plain name/description when
  // set — see getCategorySeoOverride's doc comment for why this is a
  // second, independent lookup instead of a field on `category`.
  const { title, description } = resolveCategoryMetadata(
    {
      title: category.name,
      description:
        category.description ??
        `Shop ${category.name} from DAAKYKA Apparels — Pan India delivery.`,
    },
    await getCategorySeoOverride(slug),
  );

  // release-hardening F-101: /category/for-hospitals, /category/school-uniforms
  // and /category/kids-wear duplicate the section landing pages at
  // /for-hospitals, /school-uniforms, /kids-wear — canonicalize to the
  // landing page for those three slugs instead of self-canonicalizing.
  const canonical = sectionLandingPath(slug) ?? `/category/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath(canonical) },
    // F-151: og:url wasn't set on any page — see the root layout's doc
    // comment on why title/description don't need repeating here.
    openGraph: baseOpenGraph(canonical),
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
