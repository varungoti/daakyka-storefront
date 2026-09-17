import { ProductCard } from "@/components/ui/product-card";
import { ProductDetail, type ReviewEligibility } from "@/components/product/product-detail";
import { ProductViewTracker } from "@/components/product/product-view-tracker";
import { JsonLdScript } from "@/components/seo/json-ld-script";
import { getSizeChartForProduct } from "@/lib/catalog/size-charts";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";
import { getCategoryBySlug, getProductByHandle, getProducts } from "@/lib/products";
import { getApprovedReviews, getReviewSummary } from "@/lib/reviews";
import { breadcrumbJsonLd, productJsonLd, siteUrlBase } from "@/lib/seo/json-ld";
import { getSetting } from "@/lib/settings";
import Link from "next/link";
import { notFound } from "next/navigation";

interface ProductPageProps {
  params: Promise<{ handle: string }>;
}

const SECTION_LANDING: Record<string, { label: string; href: string }> = {
  HOSPITAL: { label: "For Hospitals", href: "/for-hospitals" },
  SCHOOL: { label: "School Uniforms", href: "/school-uniforms" },
  KIDS: { label: "Kids Wear", href: "/kids-wear" },
};

/**
 * Phase D2: the real "can this visitor write a review for this product"
 * state — replaces the Phase C5 placeholder that only ever checked for the
 * customer cookie's *presence* (D1 didn't exist yet, so it was always
 * "guest"). Computed here, server-side, from the real customer session
 * (never trusted from the client) plus a single extra lookup against the
 * @@unique([productId, customerId]) constraint that also backs
 * createReview()'s own duplicate check — cheap, and means the button never
 * has to render a form only to 409 on submit for a customer who already
 * reviewed this exact product.
 */
async function getReviewEligibility(productId: string): Promise<ReviewEligibility> {
  const session = await getCustomerSession();
  if (!session) return { status: "guest" };
  if (!session.emailVerifiedAt) return { status: "unverified" };

  const existing = await db.review.findUnique({
    where: { productId_customerId: { productId, customerId: session.id } },
    select: { id: true },
  });
  if (existing) return { status: "already-reviewed" };

  return { status: "eligible" };
}

export async function generateMetadata({ params }: ProductPageProps) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);

  if (!product) {
    return { title: "Product Not Found" };
  }

  return {
    title: product.name,
    description:
      product.description ??
      `${product.name} in ${product.colorName}. Premium medical apparel by DAAKYKA.`,
    openGraph: {
      title: product.name,
      description: product.description,
      images: [product.image],
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);

  if (!product) {
    notFound();
  }

  const [allProducts, reviewEligibility, sizeChart, reviewSummary, initialReviews, flatRate, freeAbove, resolvedCategory] =
    await Promise.all([
      getProducts(),
      getReviewEligibility(product.id),
      getSizeChartForProduct(product.id),
      getReviewSummary(product.id),
      getApprovedReviews(product.id, { page: 1 }),
      getSetting("shipping.flatRate"),
      getSetting("shipping.freeAbove"),
      product.categorySlug ? getCategoryBySlug(product.categorySlug) : Promise.resolve(null),
    ]);

  const related = allProducts
    .filter((item) => item.category === product.category && item.id !== product.id)
    .slice(0, 4);

  const base = siteUrlBase();

  // Home > section landing (For Hospitals / School Uniforms / Kids Wear /
  // Shop) > category (linked only if it actually resolves in the DB
  // category tree, else falls back to /shop) > product name (current
  // page, unlinked).
  const sectionInfo = (product.section && SECTION_LANDING[product.section]) || { label: "Shop", href: "/shop" };
  const categoryHref = resolvedCategory ? `/category/${resolvedCategory.slug}` : "/shop";
  const breadcrumbItems: { name: string; url: string }[] = [
    { name: "Home", url: base },
    { name: sectionInfo.label, url: `${base}${sectionInfo.href}` },
  ];
  if (product.categoryName && product.categoryName !== sectionInfo.label) {
    breadcrumbItems.push({ name: product.categoryName, url: `${base}${categoryHref}` });
  }
  breadcrumbItems.push({ name: product.name, url: `${base}/products/${product.handle}` });

  return (
    <>
      <JsonLdScript
        data={productJsonLd({
          ...product,
          images: product.images?.map((img) => img.url),
        })}
      />
      <JsonLdScript data={breadcrumbJsonLd(breadcrumbItems)} />

      <section className="border-b border-border bg-alt-surface py-6">
        <div className="mx-auto max-w-[1320px] px-4 text-sm text-muted lg:px-8">
          {breadcrumbItems.map((crumb, index) => {
            const isLast = index === breadcrumbItems.length - 1;
            return (
              <span key={crumb.name}>
                {index > 0 && <span className="mx-2">›</span>}
                {isLast ? (
                  <span className="font-semibold text-ink">{crumb.name}</span>
                ) : (
                  <Link
                    href={index === 0 ? "/" : crumb.url.replace(base, "")}
                    className="hover:text-brand"
                  >
                    {crumb.name}
                  </Link>
                )}
              </span>
            );
          })}
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
          <ProductViewTracker handle={product.handle} name={product.name} />
          <ProductDetail
            product={product}
            reviewEligibility={reviewEligibility}
            sizeChart={sizeChart}
            reviewSummary={reviewSummary}
            initialReviews={initialReviews}
            shipping={{ flatRate, freeAbove }}
          />
        </div>
      </section>

      {related.length > 0 && (
        <section className="border-t border-border bg-alt-surface py-16">
          <div className="mx-auto max-w-[1320px] px-4 lg:px-8">
            <h2 className="mb-8 font-display text-2xl font-bold text-ink">
              You May Also Like
            </h2>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {related.map((item) => (
                <ProductCard key={item.id} product={item} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
