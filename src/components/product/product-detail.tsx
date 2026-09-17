"use client";

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { Badge } from "@/components/ui/badge";
import { ImageLightbox, type LightboxImage } from "@/components/ui/image-lightbox";
import { Modal } from "@/components/ui/modal";
import { StarRating } from "@/components/ui/star-rating";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { useCurrency } from "@/context/currency-provider";
import type { SizeChartForDisplay } from "@/lib/catalog/size-charts";
import { computePercentOff } from "@/lib/pricing/percent-off";
import { isSizeAvailableForColor, resolveVariant } from "@/lib/products/resolve-variant";
import type { DisplayReview, GetApprovedReviewsResult, ReviewSort, ReviewSummary } from "@/lib/reviews";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronDown, Minus, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";

export type ReviewEligibility =
  | { status: "guest" }
  | { status: "unverified" }
  | { status: "already-reviewed" }
  | { status: "eligible" };

interface ProductDetailProps {
  product: Product;
  reviewEligibility: ReviewEligibility;
  sizeChart: SizeChartForDisplay | null;
  reviewSummary: ReviewSummary;
  initialReviews: GetApprovedReviewsResult;
  shipping: { flatRate: number; freeAbove: number };
}

const INSTITUTIONAL_SECTIONS = new Set(["HOSPITAL", "SCHOOL"]);

/**
 * Phase C5 rewrite, extended in Phase D2 with real review submission
 * (rating/title/body/photos, gated on `reviewEligibility` computed
 * server-side in the page). Variant resolution goes through
 * src/lib/products/resolve-variant.ts instead of the inline size/colour
 * matching the old component had.
 */
export function ProductDetail({
  product,
  reviewEligibility,
  sizeChart,
  reviewSummary,
  initialReviews,
  shipping,
}: ProductDetailProps) {
  const { formatPrice } = useCurrency();

  const [selectedColor, setSelectedColor] = useState(product.colorName);
  const [selectedSize, setSelectedSize] = useState(product.sizes[0] ?? "");
  const [quantity, setQuantity] = useState(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);

  const gallery = useMemo<LightboxImage[]>(() => {
    const colorImages = product.images?.filter((img) => img.color === selectedColor) ?? [];
    const source =
      colorImages.length > 0
        ? colorImages
        : product.images && product.images.length > 0
          ? product.images
          : [{ url: product.image, alt: product.name }];
    return source.map((img) => ({ url: img.url, alt: img.alt ?? product.name }));
  }, [product.images, product.image, product.name, selectedColor]);

  const selectedVariant = useMemo(
    () => resolveVariant(product.variants, selectedSize, selectedColor),
    [product.variants, selectedSize, selectedColor],
  );

  const displayPrice = selectedVariant?.price ?? product.price;
  const percentOff = computePercentOff(displayPrice, product.compareAtPrice);
  const isInstitutional = Boolean(product.section && INSTITUTIONAL_SECTIONS.has(product.section));
  const sizeUnavailable =
    Boolean(selectedSize) && !isSizeAvailableForColor(product.variants, selectedSize, selectedColor);

  return (
    <div>
      <div className="grid gap-12 lg:grid-cols-2">
        <GalleryColumn
          images={gallery}
          selectedColor={selectedColor}
          productName={product.name}
          onOpenLightbox={setLightboxIndex}
        />

        <div className="space-y-6">
          <div>
            <h1 className="font-display text-4xl font-bold text-ink">{product.name}</h1>
            {product.reviewCount > 0 ? (
              <a
                href="#reviews"
                className="mt-2 inline-block text-sm font-semibold text-ink hover:text-brand"
              >
                {product.rating.toFixed(1)} · {product.reviewCount} review
                {product.reviewCount === 1 ? "" : "s"}
              </a>
            ) : (
              <p className="mt-2 text-sm text-muted">No reviews yet</p>
            )}
          </div>

          <div className="flex flex-wrap items-baseline gap-3">
            <p className="font-display text-3xl font-bold text-ink">{formatPrice(displayPrice)}</p>
            {product.compareAtPrice !== undefined && product.compareAtPrice > displayPrice && (
              <>
                <p className="text-lg text-muted line-through">{formatPrice(product.compareAtPrice)}</p>
                {percentOff !== null && <Badge variant="sale">{percentOff}% Off</Badge>}
              </>
            )}
          </div>

          <p className="leading-relaxed text-muted">
            {product.description ??
              "Premium apparel engineered for all-day comfort and durability, built for healthcare and institutional wear."}
          </p>

          {product.colors.length > 1 && (
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Color</p>
              <div className="flex flex-wrap gap-3">
                {product.colors.map((color) => (
                  <button
                    key={color.name}
                    type="button"
                    onClick={() => setSelectedColor(color.name)}
                    aria-pressed={selectedColor === color.name}
                    aria-label={color.name}
                    title={color.name}
                    className={cn(
                      "h-10 w-10 rounded-full border-2 transition",
                      selectedColor === color.name
                        ? "border-brand ring-2 ring-brand/20"
                        : "border-transparent hover:border-border",
                    )}
                    style={{ backgroundColor: color.hex }}
                  />
                ))}
              </div>
            </div>
          )}

          {product.sizes.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wide text-muted">Size</p>
                <button
                  type="button"
                  onClick={() => setSizeGuideOpen(true)}
                  className="text-sm font-semibold text-brand hover:underline"
                >
                  Size Guide
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {product.sizes.map((size) => {
                  const available = isSizeAvailableForColor(product.variants, size, selectedColor);
                  return (
                    <button
                      key={size}
                      type="button"
                      disabled={!available}
                      onClick={() => setSelectedSize(size)}
                      aria-pressed={selectedSize === size}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-sm font-semibold transition",
                        !available && "cursor-not-allowed border-border text-muted/50 line-through",
                        available &&
                          (selectedSize === size
                            ? "border-brand bg-brand/10 text-brand"
                            : "border-border hover:border-brand"),
                      )}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
              {sizeUnavailable && (
                <p className="mt-2 text-xs font-semibold text-sale">Out of stock in this size/colour</p>
              )}
            </div>
          )}

          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Quantity</p>
            <div className="inline-flex items-center rounded-md border border-border">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="px-3 py-2 text-ink transition hover:bg-lilac/40"
                aria-label="Decrease quantity"
              >
                <Minus size={16} />
              </button>
              <span className="min-w-10 text-center text-sm font-semibold">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                className="px-3 py-2 text-ink transition hover:bg-lilac/40"
                aria-label="Increase quantity"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 pt-2">
            <AddToCartButton product={product} variant={selectedVariant} quantity={quantity} size="lg" />
            <AddToCartButton
              product={product}
              variant={selectedVariant}
              quantity={quantity}
              size="lg"
              variantStyle="outline"
              label="Buy Now"
              redirectToCheckout
            />
            <WishlistButton product={product} className="border border-border p-4" />
          </div>

          {isInstitutional && (
            <Link
              href="/bulk-orders"
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
            >
              Need bulk pricing? Enquire <span aria-hidden="true">→</span>
            </Link>
          )}
        </div>
      </div>

      <div className="mt-12 max-w-3xl">
        <AccordionItem title="Description" defaultOpen>
          <p>
            {product.description ??
              "Premium apparel engineered for all-day comfort and durability, built for healthcare and institutional wear."}
          </p>
        </AccordionItem>

        <AccordionItem title="Fabric & Care">
          {product.fabric || product.care ? (
            <ul className="space-y-1">
              {product.fabric && (
                <li>
                  <span className="font-semibold text-ink">Fabric: </span>
                  {product.fabric}
                </li>
              )}
              {product.care && (
                <li>
                  <span className="font-semibold text-ink">Care: </span>
                  {product.care}
                </li>
              )}
            </ul>
          ) : (
            <p>Fabric and care details for this product haven&apos;t been added yet.</p>
          )}
        </AccordionItem>

        <AccordionItem title="Shipping & Returns">
          <p>
            Flat {formatPrice(shipping.flatRate)} shipping, free on orders above{" "}
            {formatPrice(shipping.freeAbove)}. Get in touch within 7 days of delivery for returns or
            exchanges.
          </p>
        </AccordionItem>

        {isInstitutional && (
          <AccordionItem title="Bulk Orders">
            <p>
              Ordering for a hospital, school, or organisation? We offer volume pricing, colour
              standardisation and logo embroidery.{" "}
              <Link href="/bulk-orders" className="font-semibold text-brand hover:underline">
                Enquire about bulk orders →
              </Link>
            </p>
          </AccordionItem>
        )}
      </div>

      <ReviewsSection
        product={product}
        summary={reviewSummary}
        initialReviews={initialReviews}
        reviewEligibility={reviewEligibility}
      />

      {lightboxIndex !== null && (
        <ImageLightbox images={gallery} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}

      {sizeGuideOpen && (
        <Modal title="Size Guide" onClose={() => setSizeGuideOpen(false)}>
          {sizeChart ? (
            <SizeChartTable chart={sizeChart} />
          ) : (
            <p className="text-sm text-muted">
              A size chart isn&apos;t set up for this product yet. See our{" "}
              <Link
                href="/size-guide"
                className="font-semibold text-brand hover:underline"
                onClick={() => setSizeGuideOpen(false)}
              >
                general size guide
              </Link>{" "}
              in the meantime.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

function GalleryColumn({
  images,
  selectedColor,
  productName,
  onOpenLightbox,
}: {
  images: LightboxImage[];
  selectedColor: string;
  productName: string;
  onOpenLightbox: (index: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  // The gallery swaps when the selected colour changes (filtered to that
  // colour's images) — reset back to the first image so we never point
  // at an index the new gallery doesn't have.
  const [lastColor, setLastColor] = useState(selectedColor);
  if (selectedColor !== lastColor) {
    setLastColor(selectedColor);
    setActiveIndex(0);
  }

  const active = images[Math.min(activeIndex, images.length - 1)] ?? images[0];

  return (
    <div className="flex flex-col-reverse gap-4 lg:flex-row">
      {images.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-1 lg:w-20 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0">
          {images.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={cn(
                "relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border-2 transition",
                index === activeIndex ? "border-brand ring-2 ring-brand/20" : "border-border hover:border-brand/50",
              )}
              aria-label={`View ${productName} image ${index + 1}`}
              aria-current={index === activeIndex}
            >
              <Image
                src={image.url}
                alt={image.alt ?? `${productName} view ${index + 1}`}
                fill
                unoptimized={image.url.endsWith(".svg")}
                className="object-cover"
                sizes="80px"
              />
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onOpenLightbox(activeIndex)}
        aria-label={`View full-screen images of ${productName}`}
        className="relative aspect-[4/5] flex-1 overflow-hidden rounded-[2rem] border border-border bg-lilac/20"
      >
        <Image
          src={active.url}
          alt={active.alt ?? productName}
          fill
          priority
          unoptimized={active.url.endsWith(".svg")}
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 50vw"
        />
      </button>
    </div>
  );
}

function AccordionItem({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group border-b border-border py-4" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between font-display text-base font-semibold text-ink">
        {title}
        <ChevronDown size={18} className="shrink-0 text-muted transition group-open:rotate-180" />
      </summary>
      <div className="mt-3 text-sm leading-relaxed text-muted">{children}</div>
    </details>
  );
}

function SizeChartTable({ chart }: { chart: SizeChartForDisplay }) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {chart.columns.map((column) => (
                <th key={column} className="px-3 py-2 font-semibold text-ink">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row, index) => (
              <tr key={index} className="border-b border-border/60">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 text-muted">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chart.notes && <p className="mt-3 text-xs text-muted">{chart.notes}</p>}
      <p className="mt-2 text-xs text-muted">
        Measurements in {chart.unit === "IN" ? "inches" : "centimeters"}.
      </p>
    </div>
  );
}

function ReviewsSection({
  product,
  summary,
  initialReviews,
  reviewEligibility,
}: {
  product: Product;
  summary: ReviewSummary;
  initialReviews: GetApprovedReviewsResult;
  reviewEligibility: ReviewEligibility;
}) {
  const [sort, setSort] = useState<ReviewSort>("newest");
  const [result, setResult] = useState(initialReviews);
  const [loading, setLoading] = useState(false);
  const [photoLightbox, setPhotoLightbox] = useState<{ photos: DisplayReview["photos"]; index: number } | null>(
    null,
  );
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fetchReviews = async (nextSort: ReviewSort, page: number, append: boolean) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/products/${product.handle}/reviews?sort=${nextSort}&page=${page}`,
      );
      const data = (await response.json()) as GetApprovedReviewsResult;
      setResult((prev) => (append ? { ...data, reviews: [...prev.reviews, ...data.reviews] } : data));
    } catch {
      // Keep whatever we already had rendered rather than clearing it on
      // a transient network error.
    } finally {
      setLoading(false);
    }
  };

  const handleSortChange = (nextSort: ReviewSort) => {
    setSort(nextSort);
    void fetchReviews(nextSort, 1, false);
  };

  const handleLoadMore = () => {
    void fetchReviews(sort, result.page + 1, true);
  };

  const returnTo = `/products/${product.handle}#reviews`;

  return (
    <section id="reviews" className="mt-16 scroll-mt-24 border-t border-border pt-12">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-display text-2xl font-bold text-ink">Reviews</h2>
        {reviewEligibility.status === "guest" && (
          <Link
            href={`/account/login?returnTo=${encodeURIComponent(returnTo)}`}
            className="rounded-md border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white"
          >
            Write a Review
          </Link>
        )}
        {reviewEligibility.status === "eligible" && !showForm && !submitted && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="rounded-md border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white"
          >
            Write a Review
          </button>
        )}
      </div>

      {reviewEligibility.status === "unverified" && (
        <p className="mt-3 rounded-lg bg-alt-surface px-4 py-3 text-sm text-muted">
          Please verify your email address before writing a review — check your inbox for the
          verification link we sent when you registered.
        </p>
      )}

      {reviewEligibility.status === "already-reviewed" && !submitted && (
        <p className="mt-3 rounded-lg bg-alt-surface px-4 py-3 text-sm text-muted">
          You&apos;ve already reviewed this product.
        </p>
      )}

      {submitted && (
        <p className="mt-3 rounded-lg bg-trust/10 px-4 py-3 text-sm font-medium text-trust">
          Thanks — your review is awaiting moderation.
        </p>
      )}

      {reviewEligibility.status === "eligible" && showForm && !submitted && (
        <ReviewForm
          productId={product.id}
          onCancel={() => setShowForm(false)}
          onSubmitted={() => {
            setShowForm(false);
            setSubmitted(true);
          }}
        />
      )}

      <div className="mt-6 grid gap-10 md:grid-cols-[240px_1fr]">
        <div>
          {summary.count > 0 ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-bold text-ink">
                  {summary.average.toFixed(1)}
                </span>
                <StarRating rating={summary.average} />
              </div>
              <p className="mt-1 text-sm text-muted">
                Based on {summary.count} review{summary.count === 1 ? "" : "s"}
              </p>
              <div className="mt-4 space-y-1.5">
                {([5, 4, 3, 2, 1] as const).map((star) => {
                  const count = summary.histogram[star];
                  const pct = summary.count > 0 ? Math.round((count / summary.count) * 100) : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs text-muted">
                      <span className="w-3">{star}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-8 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">No reviews yet. Be the first to share your experience.</p>
          )}
        </div>

        <div>
          {result.reviews.length > 0 && (
            <div className="mb-4 flex items-center justify-end gap-2 text-sm">
              <label htmlFor="review-sort" className="text-muted">
                Sort by
              </label>
              <select
                id="review-sort"
                value={sort}
                onChange={(event) => handleSortChange(event.target.value as ReviewSort)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-brand"
              >
                <option value="newest">Newest</option>
                <option value="highest">Highest rated</option>
                <option value="lowest">Lowest rated</option>
              </select>
            </div>
          )}

          {result.reviews.length === 0 ? (
            <p className="text-sm text-muted">
              This product has no reviews yet — check back soon, or be the first once you&apos;ve tried it.
            </p>
          ) : (
            <ul className="space-y-6">
              {result.reviews.map((review) => (
                <li key={review.id} className="border-b border-border pb-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <StarRating rating={review.rating} />
                    {review.verifiedPurchase && (
                      <span className="rounded-full bg-trust/10 px-2.5 py-0.5 text-xs font-semibold text-trust">
                        Verified Buyer
                      </span>
                    )}
                  </div>
                  {review.title && (
                    <p className="mt-2 font-display font-semibold text-ink">{review.title}</p>
                  )}
                  <p className="mt-1 text-sm leading-relaxed text-muted">{review.body}</p>
                  {review.photos.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {review.photos.map((photo, index) => (
                        <button
                          key={`${photo.url}-${index}`}
                          type="button"
                          onClick={() => setPhotoLightbox({ photos: review.photos, index })}
                          className="relative h-16 w-16 overflow-hidden rounded-lg border border-border"
                          aria-label={`View review photo ${index + 1}`}
                        >
                          <Image
                            src={photo.url}
                            alt={photo.alt ?? "Review photo"}
                            fill
                            unoptimized={photo.url.endsWith(".svg")}
                            className="object-cover"
                            sizes="64px"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted">
                    {review.reviewerName} ·{" "}
                    {new Date(review.createdAt).toLocaleDateString("en-IN", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {result.hasMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loading}
              className="mt-4 rounded-md border border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand disabled:opacity-50"
            >
              {loading ? "Loading..." : "Load more reviews"}
            </button>
          )}
        </div>
      </div>

      {photoLightbox && (
        <ImageLightbox
          images={photoLightbox.photos}
          startIndex={photoLightbox.index}
          onClose={() => setPhotoLightbox(null)}
        />
      )}
    </section>
  );
}

const REVIEW_TITLE_MIN = 4;
const REVIEW_TITLE_MAX = 120;
const REVIEW_BODY_MIN = 10;
const REVIEW_BODY_MAX = 2000;
const REVIEW_MAX_PHOTOS = 3;

/**
 * Phase D2 review submission form — rendered only once the server has
 * already confirmed (`reviewEligibility.status === "eligible"`) that this
 * customer is logged in, email-verified, and hasn't reviewed this product
 * yet. The server re-checks all of that again in POST /api/reviews (never
 * trust the client), so this form's only job is a good submission UX, not
 * enforcement.
 */
function ReviewForm({
  productId,
  onCancel,
  onSubmitted,
}: {
  productId: string;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleLength = title.trim().length;
  const bodyLength = body.trim().length;
  const canSubmit =
    rating >= 1 &&
    rating <= 5 &&
    titleLength >= REVIEW_TITLE_MIN &&
    titleLength <= REVIEW_TITLE_MAX &&
    bodyLength >= REVIEW_BODY_MIN &&
    bodyLength <= REVIEW_BODY_MAX &&
    !submitting;

  async function handlePhotoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (photoIds.length >= REVIEW_MAX_PHOTOS) {
      setError(`You can attach up to ${REVIEW_MAX_PHOTOS} photos.`);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/reviews/photos", { method: "POST", body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Photo upload failed");
      }
      const data = (await response.json()) as { id: string };
      setPhotoIds((prev) => [...prev, data.id]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          rating,
          title: title.trim(),
          body: body.trim(),
          photoAssetIds: photoIds,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not submit your review");
      }

      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your review");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded-2xl border border-border bg-alt-surface p-5">
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-ink">Your rating</label>
        <div className="flex items-center gap-1" onMouseLeave={() => setHoverRating(0)}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoverRating(star)}
              aria-label={`${star} star${star === 1 ? "" : "s"}`}
              className="p-0.5"
            >
              <span
                className={cn(
                  "text-2xl",
                  (hoverRating || rating) >= star ? "text-amber-400" : "text-star-empty",
                )}
              >
                ★
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="review-title" className="mb-1.5 block text-sm font-semibold text-ink">
          Title
        </label>
        <input
          id="review-title"
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={REVIEW_TITLE_MAX}
          placeholder="Sum up your experience"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
      </div>

      <div>
        <label htmlFor="review-body" className="mb-1.5 block text-sm font-semibold text-ink">
          Review
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={REVIEW_BODY_MAX}
          rows={4}
          placeholder="What did you like or dislike? How was the fit and fabric?"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
        <p className="mt-1 text-xs text-muted">{bodyLength}/{REVIEW_BODY_MAX} characters</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-ink">
          Photos <span className="font-normal text-muted">(optional, up to {REVIEW_MAX_PHOTOS})</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {photoIds.map((id) => (
            <span key={id} className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted">
              Photo attached
            </span>
          ))}
          {photoIds.length < REVIEW_MAX_PHOTOS && (
            <label className="cursor-pointer rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-brand hover:text-brand">
              {uploading ? "Uploading…" : "Add photo"}
              <input type="file" accept="image/*" onChange={handlePhotoUpload} disabled={uploading} className="hidden" />
            </label>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit Review"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-ink transition hover:border-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
