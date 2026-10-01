"use client";

import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { ResendVerificationButton } from "@/components/account/resend-verification-button";
import { MobileStickyAddToCart } from "@/components/product/mobile-sticky-add-to-cart";
import { Badge } from "@/components/ui/badge";
import type { LightboxImage } from "@/components/ui/image-lightbox";
import { Modal } from "@/components/ui/modal";
import { StarRating } from "@/components/ui/star-rating";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import type { SizeChartForDisplay } from "@/lib/catalog/size-charts";
import { selectProductGallery } from "@/lib/catalog/select-product-gallery";
import { formatDateIST } from "@/lib/format/datetime";
import { prepareImageForUpload } from "@/lib/media/prepare-upload";
import { computePercentOff } from "@/lib/pricing/percent-off";
import { findExactVariant, isSizeAvailableForColor, isVariantInStock, resolveVariant, variantExists } from "@/lib/products/resolve-variant";
import { NotifyWhenAvailable } from "@/components/product/notify-when-available";
import type { DisplayReview, GetApprovedReviewsResult, ReviewSort, ReviewSummary } from "@/lib/reviews";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChevronDown, Minus, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";

// release-hardening perf pass: the full-screen viewer is only ever
// mounted once a shopper clicks a thumbnail or a review photo
// (`{lightboxIndex !== null && <ImageLightbox .../>}` below) — it was
// already conditionally *rendered*, but a static top-level import still
// ships its code in the PDP's main bundle whether or not it's ever
// opened. next/dynamic makes the fetch itself on-demand too. See
// docs/PERFORMANCE.md.
const ImageLightbox = dynamic(() => import("@/components/ui/image-lightbox").then((mod) => mod.ImageLightbox), {
  ssr: false,
});

export type ReviewEligibility =
  | { status: "guest" }
  | { status: "unverified"; email: string }
  | { status: "already-reviewed" }
  // F-296: a REJECTED review no longer permanently blocks this customer
  // from this product — distinct from "already-reviewed" (a
  // PENDING/APPROVED review, which does still block a second submission)
  // so the PDP can offer a fresh Write a Review form instead of a dead
  // end. See getReviewEligibility in app/products/[handle]/page.tsx and
  // createReview's resubmit-on-REJECTED path.
  | { status: "rejected" }
  | { status: "eligible" };

interface ProductDetailProps {
  product: Product;
  reviewEligibility: ReviewEligibility;
  sizeChart: SizeChartForDisplay | null;
  reviewSummary: ReviewSummary;
  initialReviews: GetApprovedReviewsResult;
  shipping: { flatRate: number; freeAbove: number; returnWindowDays: number };
  // release-hardening F-311: India Legal Metrology declarations. Resolved
  // server-side (product override falling back to the store default) so
  // this stays a plain server-provided string, never invented here.
  legal: {
    countryOfOrigin: string;
    netQuantity: string;
    manufacturer: string;
    consumerCarePhone: string;
    consumerCareEmail: string;
  };
}

const INSTITUTIONAL_SECTIONS = new Set(["HOSPITAL", "SCHOOL"]);

/** F-107: the PDP used to always default to `product.colorName` (the
 * first colour) and `product.sizes[0]` (the first size), regardless of
 * stock — so a product whose first size/colour combo happened to be sold
 * out loaded with Add to Cart already disabled and no explanation, and a
 * shopper who then picked another size could never click back to that
 * first one to reach "Notify me when available" for it (sold-out sizes
 * were `disabled`, not merely styled as sold out). Defaults to the first
 * *in-stock* variant instead, same as Shopify. Falls back to the old
 * "just pick the first of each" when nothing is in stock (or the product
 * has no DB variant data at all), so a fully sold-out product still loads
 * with a sensible selection and its own notify form. */
function pickInitialSelection(product: Product): { color: string; size: string } {
  const firstInStock = product.variants?.find((v) => isVariantInStock(v));
  if (firstInStock) {
    return { color: firstInStock.color ?? product.colorName, size: firstInStock.size ?? (product.sizes[0] ?? "") };
  }
  return { color: product.colorName, size: product.sizes[0] ?? "" };
}

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
  legal,
}: ProductDetailProps) {
  const { formatPrice } = useCurrency();
  const { cart } = useCart();

  const [selectedColor, setSelectedColor] = useState(() => pickInitialSelection(product).color);
  const [selectedSize, setSelectedSize] = useState(() => pickInitialSelection(product).size);
  const [quantity, setQuantity] = useState(1);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  // Watched by the mobile sticky Add-to-Cart bar (storefront-ux F6) to know
  // when the primary CTA row has scrolled out of the viewport.
  const ctaRowRef = useRef<HTMLDivElement>(null);

  const gallerySelection = useMemo(() => selectProductGallery({
    images: product.images ?? [],
    productName: product.name,
    color: selectedColor,
    size: selectedSize,
    colorCount: product.colors.length,
  }), [product.images, product.name, product.colors.length, selectedColor, selectedSize]);
  const gallery: LightboxImage[] = gallerySelection.images;

  // `selectedVariant`: resolveVariant's fallback-if-no-exact-match
  // behaviour — kept only for what's safe to fall back on, price/gallery
  // display, so the page still shows *a* price while nothing's fully
  // selected. `exactVariant`: F-103's fix — the shopper's *exact* current
  // (size, colour) pick, with no substitution, used for everything that
  // actually commits to a variant (Add to Cart, Buy Now, notify-me, the
  // quantity cap). Passing resolveVariant's fallback to any of those is
  // the bug this fixes: it let Add to Cart silently add a different
  // colour (or size) than the one shown as selected.
  const selectedVariant = useMemo(
    () => resolveVariant(product.variants, selectedSize, selectedColor),
    [product.variants, selectedSize, selectedColor],
  );
  const exactVariant = useMemo(
    () => findExactVariant(product.variants, selectedSize, selectedColor),
    [product.variants, selectedSize, selectedColor],
  );

  const displayPrice = selectedVariant?.price ?? product.price;
  const percentOff = computePercentOff(displayPrice, product.compareAtPrice);
  const isInstitutional = Boolean(product.section && INSTITUTIONAL_SECTIONS.has(product.section));
  // F-103: a size/colour combo that simply doesn't exist as a variant row
  // (not merely sold out) — see variantExists' own doc comment for why
  // this needs to be distinct from isSizeAvailableForColor's stock check.
  const comboMissing = Boolean(selectedSize) && !variantExists(product.variants, selectedSize, selectedColor);
  const sizeUnavailable =
    Boolean(selectedSize) && !isSizeAvailableForColor(product.variants, selectedSize, selectedColor);
  // Shopify-parity gap: "Notify me when available". Only for a real,
  // DB-tracked variant (typeof stock === "number" — see
  // isVariantInStock's own doc comment) that's the shopper's *exact*
  // current selection and is currently out-of-stock; a Shopify-/legacy-
  // seed-backed product with no native stock tracking has no
  // ProductVariant.id to subscribe against, so it's out of scope here.
  const notifyMeVariantId =
    exactVariant && typeof exactVariant.stock === "number" && !isVariantInStock(exactVariant) ? exactVariant.id : null;

  // F-108: cap the quantity stepper at the variant's real stock, minus
  // whatever's already sitting in the cart for it — the stepper used to
  // have no ceiling at all, so a shopper could set 10 against a
  // 3-in-stock variant and only find out at Place Order. `Infinity` for a
  // variant that doesn't track stock (Shopify/legacy seed) or when
  // nothing is exactly selected yet, so this never disables the stepper
  // for those.
  const alreadyInCartQuantity =
    exactVariant ? (cart.lines.find((line) => line.variantId === exactVariant.id)?.quantity ?? 0) : 0;
  const maxQuantity =
    exactVariant && typeof exactVariant.stock === "number"
      ? Math.max(0, exactVariant.stock - alreadyInCartQuantity)
      : Infinity;
  // Re-clamp when the selection changes to a variant with a lower ceiling
  // (or none at all) — adjusted during render, not a useEffect, per this
  // repo's react-hooks/set-state-in-effect convention (see
  // GalleryColumn's `lastColor` below for the same pattern).
  const selectionKey = `${selectedSize}::${selectedColor}`;
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey);
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey);
    const capped = Math.max(1, Math.min(quantity, Number.isFinite(maxQuantity) ? maxQuantity : quantity));
    if (capped !== quantity) setQuantity(capped);
  }

  return (
    <div>
      <div className="grid gap-12 lg:grid-cols-2">
        <GalleryColumn
          images={gallery}
          selectionKey={`${selectedColor}::${selectedSize}`}
          representativeFallback={gallerySelection.representativeFallback}
          selectedSize={selectedSize}
          productName={product.name}
          onOpenLightbox={setLightboxIndex}
        />

        <div className="space-y-6">
          <div>
            <h1 className="font-display text-4xl font-bold text-ink">{product.name}</h1>
            {/* F-298: reads the freshly-fetched reviewSummary, not
                product.reviewCount/rating (cached under the "products"
                tag) — moderation revalidates that tag with a "max" profile,
                which serves one more stale (pre-approval) response before
                it catches up, so the header used to say "No reviews yet"
                while the Reviews section below already showed the
                approved review. reviewSummary is never cached, so it's
                always in sync with what the Reviews section renders. */}
            {reviewSummary.count > 0 ? (
              <a
                href="#reviews"
                className="mt-2 inline-block text-sm font-semibold text-ink hover:text-brand"
              >
                {reviewSummary.average.toFixed(1)} · {reviewSummary.count} review
                {reviewSummary.count === 1 ? "" : "s"}
              </a>
            ) : (
              <p className="mt-2 text-sm text-muted">No reviews yet</p>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-baseline gap-3">
              <p className="font-display text-3xl font-bold text-ink">{formatPrice(displayPrice)}</p>
              {product.compareAtPrice !== undefined && product.compareAtPrice > displayPrice && (
                <>
                  {/* F-313: the reference price is the product's MRP, not an
                      unlabelled "was" price — the label sits outside the
                      <s> so it isn't struck through itself, and the sr-only
                      text spells out both prices for anyone whose screen
                      reader skips line-through styling. */}
                  <p className="text-lg text-muted">
                    <span aria-hidden="true">MRP </span>
                    <s>{formatPrice(product.compareAtPrice)}</s>
                    <span className="sr-only">
                      Maximum retail price {formatPrice(product.compareAtPrice)}, now {formatPrice(displayPrice)}
                    </span>
                  </p>
                  {percentOff !== null && <Badge variant="sale">{percentOff}% Off</Badge>}
                </>
              )}
            </div>
            {/* F-311/F-125/F-313: Legal Metrology requires the price shown
                before purchase to be labelled inclusive of all taxes. */}
            <p className="mt-1 text-xs text-muted">Inclusive of all taxes</p>
          </div>

          {/* release-hardening audit F-111: this used to always render
              `product.description` — the exact same text (as plain text)
              the "Description" accordion below renders again as HTML, so
              every product with a description showed it twice on the page,
              and the admin's "Short description" field was never shown
              anywhere. Now: a distinct, hand-written teaser when the admin
              set one, and nothing here otherwise (the accordion below
              always has its own fallback copy). */}
          {product.shortDescription && (
            <p className="leading-relaxed text-muted">{product.shortDescription}</p>
          )}

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
                  // F-107: sold out (combo exists, no stock) only gets
                  // struck through — it stays clickable, so a shopper can
                  // select it and reach "Notify me when available" for it.
                  // F-103: a combo that doesn't exist as a row at all is
                  // the only case that's truly `disabled`.
                  const inStock = isSizeAvailableForColor(product.variants, size, selectedColor);
                  const exists = variantExists(product.variants, size, selectedColor);
                  const isSelected = selectedSize === size;
                  return (
                    <button
                      key={size}
                      type="button"
                      disabled={!exists}
                      onClick={() => setSelectedSize(size)}
                      aria-pressed={isSelected}
                      aria-label={exists && !inStock ? `${size}, sold out` : undefined}
                      className={cn(
                        "rounded-lg border px-4 py-2 text-sm font-semibold transition",
                        !exists && "cursor-not-allowed border-border text-muted/50 line-through",
                        exists && !inStock && "line-through",
                        exists &&
                          (isSelected ? "border-brand bg-brand/10 text-brand" : "border-border hover:border-brand"),
                      )}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
              {sizeUnavailable && (
                <p className="mt-2 text-xs font-semibold text-sale">
                  {comboMissing ? "Not available in this size/colour" : "Out of stock in this size/colour"}
                </p>
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
                // F-108: was uncapped — a shopper could set the quantity
                // past a low-stock variant's real stock and only find out
                // at Place Order.
                onClick={() => setQuantity((q) => Math.min(Number.isFinite(maxQuantity) ? maxQuantity : q + 1, q + 1))}
                disabled={quantity >= maxQuantity}
                className="px-3 py-2 text-ink transition hover:bg-lilac/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                aria-label="Increase quantity"
              >
                <Plus size={16} />
              </button>
            </div>
            {Number.isFinite(maxQuantity) && maxQuantity > 0 && maxQuantity <= 5 && (
              <p className="mt-1 text-xs text-muted">Only {maxQuantity} left</p>
            )}
            {maxQuantity === 0 && (
              <p className="mt-1 text-xs font-semibold text-sale">All available units are already in your cart</p>
            )}
          </div>

          <div ref={ctaRowRef} className="flex flex-wrap gap-4 pt-2">
            <AddToCartButton product={product} variant={exactVariant} unavailable={comboMissing} quantity={quantity} size="lg" />
            <AddToCartButton
              product={product}
              variant={exactVariant}
              unavailable={comboMissing}
              quantity={quantity}
              size="lg"
              variantStyle="outline"
              label="Buy Now"
              redirectToCheckout
            />
            <WishlistButton product={product} className="border border-border p-4" />
          </div>

          {notifyMeVariantId && <NotifyWhenAvailable key={notifyMeVariantId} variantId={notifyMeVariantId} />}

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
          {product.descriptionHtml ? (
            // F-12 (docs/audit-2026-09-19/admin-ux.md): `descriptionHtml` is
            // produced server-side by mapDbProductToUi via
            // src/lib/catalog/description-html.ts, which sanitizes against a
            // small allowlist (or HTML-escapes legacy plain text into
            // paragraphs) before it ever becomes a `Product` prop — this is
            // the one deliberate, narrowly-scoped use of
            // dangerouslySetInnerHTML for product content, never applied to
            // any other field.
            <div
              className="prose-description [&_a]:text-brand [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_p+p]:mt-3 [&_ul]:list-disc"
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
            />
          ) : (
            <p>Premium apparel engineered for all-day comfort and durability, built for healthcare and institutional wear.</p>
          )}
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

        {/* release-hardening F-311: Legal Metrology (Packaged Commodities)
            Rules 2011 r.6(10) and the Consumer Protection (E-Commerce)
            Rules 2020 r.6 declarations — country of origin, net quantity,
            manufacturer/marketer with address, and consumer care, shown
            before Add to Cart. `legal` is resolved server-side (a
            per-product override falling back to the store default), never
            invented in this component. */}
        <AccordionItem title="Product Information">
          <ul className="space-y-1">
            <li>
              <span className="font-semibold text-ink">Country of origin: </span>
              {legal.countryOfOrigin}
            </li>
            <li>
              <span className="font-semibold text-ink">Net quantity: </span>
              {legal.netQuantity}
            </li>
            <li>
              <span className="font-semibold text-ink">Manufactured &amp; marketed by: </span>
              {legal.manufacturer}
            </li>
            {(legal.consumerCarePhone || legal.consumerCareEmail) && (
              <li>
                <span className="font-semibold text-ink">Consumer care: </span>
                {[legal.consumerCarePhone, legal.consumerCareEmail].filter(Boolean).join(" · ")}
              </li>
            )}
          </ul>
        </AccordionItem>

        <AccordionItem title="Shipping & Returns">
          <p>
            Flat {formatPrice(shipping.flatRate)} shipping, free on orders above{" "}
            {formatPrice(shipping.freeAbove)}. Get in touch within {shipping.returnWindowDays} days of
            delivery for returns or exchanges — see our{" "}
            <Link href="/returns" className="font-semibold text-brand hover:underline">
              returns policy
            </Link>
            .
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

      <MobileStickyAddToCart
        product={product}
        variant={exactVariant}
        unavailable={comboMissing}
        quantity={quantity}
        displayPrice={displayPrice}
        observeTarget={ctaRowRef}
      />
    </div>
  );
}

function GalleryColumn({
  images,
  selectionKey,
  representativeFallback,
  selectedSize,
  productName,
  onOpenLightbox,
}: {
  images: LightboxImage[];
  selectionKey: string;
  representativeFallback: boolean;
  selectedSize: string;
  productName: string;
  onOpenLightbox: (index: number) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  // The gallery swaps when the selected colour or size changes — reset
  // back to the first image so we never point
  // at an index the new gallery doesn't have.
  const [lastSelectionKey, setLastSelectionKey] = useState(selectionKey);
  if (selectionKey !== lastSelectionKey) {
    setLastSelectionKey(selectionKey);
    setActiveIndex(0);
  }

  const active = images[Math.min(activeIndex, images.length - 1)] ?? images[0];

  return (
    <div className="space-y-2">
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
          preload
          unoptimized={active.url.endsWith(".svg")}
          className="object-cover"
          sizes="(max-width: 1024px) 100vw, 50vw"
        />
      </button>
    </div>
    {representativeFallback && (
      <p className="text-xs text-muted">Representative product image; imagery for size {selectedSize} is being verified.</p>
    )}
    {images.some((image) => image.alt?.includes("AI-generated colour interpretation")) && (
      <p className="text-xs text-muted">AI colour interpretation based on another colour of this product. Confirm the shade and design with us before ordering.</p>
    )}
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
        {/* F-296: a REJECTED review can be rewritten, same as a fresh
            "eligible" one — see the note above the form below for what's
            different about that case. */}
        {(reviewEligibility.status === "eligible" || reviewEligibility.status === "rejected") &&
          !showForm &&
          !submitted && (
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
        <div className="mt-3 rounded-lg bg-alt-surface px-4 py-3 text-sm text-muted">
          <p>
            Please verify your email address before writing a review. Check your inbox for the
            verification link from when you registered — didn&apos;t get it, or has it expired?
          </p>
          <ResendVerificationButton email={reviewEligibility.email} className="mt-2 inline-block" />
        </div>
      )}

      {reviewEligibility.status === "already-reviewed" && !submitted && (
        <p className="mt-3 rounded-lg bg-alt-surface px-4 py-3 text-sm text-muted">
          You&apos;ve already reviewed this product.
        </p>
      )}

      {reviewEligibility.status === "rejected" && !showForm && !submitted && (
        <p className="mt-3 rounded-lg bg-alt-surface px-4 py-3 text-sm text-muted">
          Your earlier review of this product didn&apos;t meet our review guidelines. You can write a
          new one.
        </p>
      )}

      {submitted && (
        <p className="mt-3 rounded-lg bg-trust/10 px-4 py-3 text-sm font-medium text-trust">
          Thanks — your review is awaiting moderation.
        </p>
      )}

      {(reviewEligibility.status === "eligible" || reviewEligibility.status === "rejected") &&
        showForm &&
        !submitted && (
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
                      <span className="rounded-full bg-trust/10 px-2.5 py-0.5 text-xs font-semibold text-trust-ink">
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
                    {review.reviewerName} · {formatDateIST(review.createdAt)}
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
  // F-030: keeps the uploaded URL alongside the id so the form can show an
  // actual thumbnail (previously just the text "Photo attached") — not
  // just the id createReview eventually gets.
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // F-295: field-level errors, only ever populated by an actual submit
  // attempt (never while the shopper is still typing) — see validate()
  // and handleSubmit below. Distinct from the free-text `error` state
  // above, which is for a submission that reached the server and failed
  // there (a network error, or a 4xx/5xx from POST /api/reviews).
  const [fieldErrors, setFieldErrors] = useState<{ rating?: string; title?: string; body?: string }>({});

  const titleLength = title.trim().length;
  const bodyLength = body.trim().length;

  /** F-295: the old version of this form just left Submit Review disabled
   * with no explanation of what was wrong — a shopper with a 4-character
   * title or a 8-character review had no way to find out why the button
   * wouldn't respond. Submit is now always clickable (bar an in-flight
   * request); clicking it computes and shows exactly which field(s) are
   * short, long, or unset. */
  function validate(): { rating?: string; title?: string; body?: string } {
    const errors: { rating?: string; title?: string; body?: string } = {};
    if (rating < 1 || rating > 5) errors.rating = "Select a star rating.";
    if (titleLength < REVIEW_TITLE_MIN || titleLength > REVIEW_TITLE_MAX) {
      errors.title = `Title must be ${REVIEW_TITLE_MIN}–${REVIEW_TITLE_MAX} characters (currently ${titleLength}).`;
    }
    if (bodyLength < REVIEW_BODY_MIN || bodyLength > REVIEW_BODY_MAX) {
      errors.body = `Review must be ${REVIEW_BODY_MIN}–${REVIEW_BODY_MAX} characters (currently ${bodyLength}).`;
    }
    return errors;
  }

  async function handlePhotoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (photos.length >= REVIEW_MAX_PHOTOS) {
      setError(`You can attach up to ${REVIEW_MAX_PHOTOS} photos.`);
      return;
    }

    setUploading(true);
    setError(null);
    try {
      // F-178: shrink a large phone photo in the browser first — Vercel
      // rejects a request body over 4.5MB before the route runs (a
      // non-JSON 413), and this route's own cap is 4MB.
      const prepared = await prepareImageForUpload(file);
      const form = new FormData();
      form.append("file", prepared);
      const response = await fetch("/api/reviews/photos", { method: "POST", body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error ?? (response.status === 413 ? "That photo is too large to upload" : "Photo upload failed"),
        );
      }
      const data = (await response.json()) as { id: string; url: string };
      setPhotos((prev) => [...prev, { id: data.id, url: data.url }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((photo) => photo.id !== id));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

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
          photoAssetIds: photos.map((photo) => photo.id),
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

  const hasErrors = Object.keys(fieldErrors).length > 0;

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4 rounded-2xl border border-border bg-alt-surface p-5" noValidate>
      {/* F-295: a single, screen-reader-announced summary of everything
          that's wrong, in addition to each field's own inline message
          below — `role="alert"` means assistive tech announces this the
          moment a failed submit sets fieldErrors, without the shopper
          having to find it. */}
      {hasErrors && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          Please fix the highlighted field{Object.keys(fieldErrors).length === 1 ? "" : "s"} below.
        </p>
      )}

      <div role="radiogroup" aria-labelledby="review-rating-label" aria-required="true" aria-invalid={Boolean(fieldErrors.rating)}>
        <span id="review-rating-label" className="mb-1.5 block text-sm font-semibold text-ink">
          Your rating
        </span>
        <div className="flex items-center gap-1" onMouseLeave={() => setHoverRating(0)}>
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              onClick={() => {
                setRating(star);
                if (fieldErrors.rating) setFieldErrors((prev) => ({ ...prev, rating: undefined }));
              }}
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
        {fieldErrors.rating && (
          <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.rating}</p>
        )}
      </div>

      <div>
        <label htmlFor="review-title" className="mb-1.5 block text-sm font-semibold text-ink">
          Title
        </label>
        <input
          id="review-title"
          type="text"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            const length = event.target.value.trim().length;
            if (fieldErrors.title && length >= REVIEW_TITLE_MIN && length <= REVIEW_TITLE_MAX) {
              setFieldErrors((prev) => ({ ...prev, title: undefined }));
            }
          }}
          maxLength={REVIEW_TITLE_MAX}
          placeholder="Sum up your experience"
          aria-invalid={Boolean(fieldErrors.title)}
          aria-describedby={fieldErrors.title ? "review-title-error" : "review-title-hint"}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
        {fieldErrors.title ? (
          <p id="review-title-error" className="mt-1 text-xs font-medium text-red-600">
            {fieldErrors.title}
          </p>
        ) : (
          <p id="review-title-hint" className="mt-1 text-xs text-muted">
            At least {REVIEW_TITLE_MIN} characters
          </p>
        )}
      </div>

      <div>
        <label htmlFor="review-body" className="mb-1.5 block text-sm font-semibold text-ink">
          Review
        </label>
        <textarea
          id="review-body"
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
            const length = event.target.value.trim().length;
            if (fieldErrors.body && length >= REVIEW_BODY_MIN && length <= REVIEW_BODY_MAX) {
              setFieldErrors((prev) => ({ ...prev, body: undefined }));
            }
          }}
          maxLength={REVIEW_BODY_MAX}
          rows={4}
          placeholder="What did you like or dislike? How was the fit and fabric?"
          aria-invalid={Boolean(fieldErrors.body)}
          aria-describedby={fieldErrors.body ? "review-body-error" : "review-body-hint"}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand"
        />
        {fieldErrors.body ? (
          <p id="review-body-error" className="mt-1 text-xs font-medium text-red-600">
            {fieldErrors.body}
          </p>
        ) : (
          <p id="review-body-hint" className="mt-1 text-xs text-muted">
            {bodyLength}/{REVIEW_BODY_MAX} characters · minimum {REVIEW_BODY_MIN}
          </p>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-ink">
          Photos <span className="font-normal text-muted">(optional, up to {REVIEW_MAX_PHOTOS})</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {/* F-030: an actual thumbnail with a remove button, not just the
              text "Photo attached" with no way to undo a wrong upload. */}
          {photos.map((photo) => (
            <div key={photo.id} className="relative h-14 w-14 overflow-hidden rounded-lg border border-border">
              <Image src={photo.url} alt="Uploaded review photo" fill className="object-cover" sizes="56px" />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                aria-label="Remove this photo"
                className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink/70 text-[10px] leading-none text-white hover:bg-ink"
              >
                ×
              </button>
            </div>
          ))}
          {photos.length < REVIEW_MAX_PHOTOS && (
            // F-030: the file input used `className="hidden"` (display:none),
            // which removes it from the tab order entirely — a keyboard user
            // could never reach "Add photo". `sr-only` keeps it visually
            // hidden but focusable, and `focus-within` puts a visible ring
            // on the label that wraps it once it's focused.
            <label className="cursor-pointer rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-brand hover:text-brand focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand">
              {uploading ? "Uploading…" : "Add photo"}
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                disabled={uploading}
                className="sr-only"
              />
            </label>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
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
