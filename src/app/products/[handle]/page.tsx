import { ProductCard } from "@/components/ui/product-card";
import { ProductDetail, type ReviewEligibility } from "@/components/product/product-detail";
import { ProductViewTracker } from "@/components/product/product-view-tracker";
import { JsonLdScript } from "@/components/seo/json-ld-script";
import { brand } from "@/data/brand";
import { getSizeChartForProduct } from "@/lib/catalog/size-charts";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";
import { getCategoryBySlug, getProductByHandle, getProducts } from "@/lib/products";
import { getApprovedReviews, getReviewSummary } from "@/lib/reviews";
import { canonicalPath } from "@/lib/seo/canonical";
import {
  baseOpenGraph,
  breadcrumbJsonLd,
  PLACEHOLDER_PRODUCT_IMAGE,
  productJsonLd,
  siteUrlBase,
} from "@/lib/seo/json-ld";
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
  if (!session.emailVerifiedAt) return { status: "unverified", email: session.email };

  const existing = await db.review.findUnique({
    where: { productId_customerId: { productId, customerId: session.id } },
    select: { id: true, status: true },
  });
  // F-296: a REJECTED review no longer permanently blocks this customer
  // from writing a new one for this product — only a still-live
  // (PENDING/APPROVED) review counts as "already reviewed". See
  // createReview's matching resubmit-on-REJECTED path.
  if (existing?.status === "REJECTED") return { status: "rejected" };
  if (existing) return { status: "already-reviewed" };

  return { status: "eligible" };
}

const META_DESCRIPTION_MAX_LENGTH = 160;

/** Trims to a word boundary rather than mid-word, so a long admin-entered
 * SEO/short description never ends mid-syllable in search results. */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const cut = trimmed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export async function generateMetadata({ params }: ProductPageProps) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);

  if (!product) {
    // release-hardening F-012: Next already tags a notFound() render
    // `noindex` on its own — `follow: true` keeps that from also fighting
    // the root layout's `index, follow`.
    return { title: "Product Not Found", robots: { index: false, follow: true } };
  }

  // release-hardening audit F-106: the admin's SEO title/description
  // (product-form.tsx's "SEO title"/"SEO description" fields, with a
  // Google-style preview) were never actually read here — the page always
  // used `name`/`description` regardless of what an admin had entered.
  // `title: { absolute: ... }` bypasses the root layout's "%s | DAAKYKA
  // Apparels" template so an admin-authored SEO title (which may already
  // include the brand name) is shown exactly as typed, not doubled up.
  const seoTitle = product.seoTitle?.trim() || undefined;
  const description = truncateAtWordBoundary(
    product.seoDescription?.trim() ||
      product.shortDescription ||
      product.description ||
      `${product.name} in ${product.colorName}. Premium medical apparel by DAAKYKA.`,
    META_DESCRIPTION_MAX_LENGTH,
  );

  // release-hardening F-110: this used to replace the whole `openGraph`
  // object with just {title, description, images}, dropping og:type/
  // og:site_name/og:locale (the root layout's openGraph doesn't merge into
  // a page-level one — see json-ld.ts's baseOpenGraph doc comment) and
  // never setting og:url at all. It also published the SVG placeholder as
  // og:image/JSON-LD image for a product with zero real photos — neither
  // social unfurlers nor Google's structured-data guidelines accept an SVG
  // there — such a product falls back to baseOpenGraph's site-wide share
  // image instead. twitter:title/description/image now come from openGraph
  // automatically (see the root layout's doc comment) — no need to repeat
  // them here.
  const hasRealImage = product.image !== PLACEHOLDER_PRODUCT_IMAGE;

  return {
    title: seoTitle ? { absolute: seoTitle } : product.name,
    description,
    alternates: { canonical: canonicalPath(`/products/${handle}`) },
    openGraph: {
      ...baseOpenGraph(`/products/${handle}`),
      title: seoTitle ?? product.name,
      description,
      ...(hasRealImage ? { images: [product.image] } : {}),
    },
  };
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { handle } = await params;
  const product = await getProductByHandle(handle);

  if (!product) {
    notFound();
  }

  const [
    allProducts,
    reviewEligibility,
    sizeChart,
    reviewSummary,
    initialReviews,
    flatRate,
    freeAbove,
    returnWindowDays,
    contactAddress,
    contactPhone,
    contactEmail,
    resolvedCategory,
  ] = await Promise.all([
    getProducts(),
    getReviewEligibility(product.id),
    getSizeChartForProduct(product.id),
    getReviewSummary(product.id),
    getApprovedReviews(product.id, { page: 1 }),
    getSetting("shipping.flatRate"),
    getSetting("shipping.freeAbove"),
    getSetting("returns.windowDays"),
    getSetting("contact.address"),
    getSetting("contact.phone"),
    getSetting("contact.email"),
    product.categorySlug ? getCategoryBySlug(product.categorySlug) : Promise.resolve(null),
  ]);

  // release-hardening F-311: Legal Metrology declarations — a per-product
  // override (set on the admin form's Compliance section) falling back to
  // the store default. Country of origin defaults to the brand's own,
  // already-known location rather than inventing one; manufacturer/
  // consumer-care fall back to the same admin-editable contact settings
  // the footer and /contact already use, so there's a single source of
  // truth instead of a third hard-coded copy.
  const legal = {
    countryOfOrigin: product.countryOfOrigin || brand.location.country,
    netQuantity: product.netQuantity || "1 N",
    manufacturer: `${brand.legalName}, ${contactAddress}`,
    consumerCarePhone: contactPhone,
    consumerCareEmail: contactEmail,
  };

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
          // F-298: the rating/reviewCount that were on `product` come from
          // the cached getProductByHandle (tagged "products", revalidated
          // with a "max" profile on approve/reject) — reviewSummary is an
          // uncached, per-request read, so it can never disagree with what
          // the Reviews section below actually renders.
          rating: reviewSummary.average,
          reviewCount: reviewSummary.count,
          // F-311: Legal Metrology declarations in structured data too.
          countryOfOrigin: legal.countryOfOrigin,
          material: product.fabric,
          manufacturer: { name: brand.legalName, address: contactAddress },
          // F-110/F-320: same variant prices and shipping/returns settings
          // the size picker and the PDP's shipping/returns copy already use
          // (fetched above), so structured data can't disagree with them.
          shipping: { flatRateInr: flatRate, freeAboveInr: freeAbove },
          returnWindowDays,
        })}
      />
      <JsonLdScript data={breadcrumbJsonLd(breadcrumbItems)} />

      <section className="border-b border-border bg-alt-surface py-6">
        <nav aria-label="Breadcrumb" className="mx-auto max-w-[1320px] px-4 text-sm text-muted lg:px-8">
          {breadcrumbItems.map((crumb, index) => {
            const isLast = index === breadcrumbItems.length - 1;
            return (
              <span key={crumb.name}>
                {index > 0 && (
                  <span aria-hidden="true" className="mx-2">
                    ›
                  </span>
                )}
                {isLast ? (
                  <span aria-current="page" className="font-semibold text-ink">
                    {crumb.name}
                  </span>
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
        </nav>
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
            shipping={{ flatRate, freeAbove, returnWindowDays }}
            legal={legal}
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
