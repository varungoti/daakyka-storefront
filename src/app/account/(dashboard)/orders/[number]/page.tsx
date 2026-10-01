import { BuyAgainButton } from "@/components/account/buy-again-button";
import { OrderPrintButton } from "@/components/account/order-print-button";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { OrderTimelineView } from "@/components/account/order-timeline";
import { OrderTrackingCard } from "@/components/account/order-tracking-card";
import { brand } from "@/data/brand";
import { formatCurrencyAmount } from "@/lib/currency/convert";
import { db } from "@/lib/db";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { getAuthorizedOrder } from "@/lib/orders/get-order";
import { formatReceiptDate, getReceiptPaymentSummary } from "@/lib/orders/receipt";
import { getOrderTimeline } from "@/lib/orders/timeline";
import { getClientIp, checkRateLimit } from "@/lib/security/rate-limit";
import { getSetting } from "@/lib/settings";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export const metadata: Metadata = { title: "Order Details" };

// F-127: was `maximumFractionDigits: 0`, which rounded a stored 638.97 total
// to "₹639" while the customer is charged (and emailed) ₹638.97.
function formatInr(amount: number): string {
  return formatCurrencyAmount(amount, "INR");
}

// Own key namespace (not get-order.ts's `order-page:` bucket used by the
// guest /order/[number] page) so a customer paging through their own
// order history never shares a rate-limit bucket with unrelated guest
// traffic from the same IP (e.g. a shared office network). A logged-in
// session can't view anyone else's order regardless (getAuthorizedOrder's
// ownership check), so this is defense-in-depth against a logged-in
// caller hammering the route — not the primary access control.
const ACCOUNT_ORDER_PAGE_RATE_LIMIT = 40;
const ACCOUNT_ORDER_PAGE_RATE_WINDOW_MS = 60_000;

/**
 * Release-hardening item 2 — per-order detail view for a signed-in
 * customer. Reuses getAuthorizedOrder (src/lib/orders/get-order.ts)
 * exactly as the guest confirmation page does (src/app/order/[number]/page.tsx,
 * not modified here, nor is src/lib/orders/access-token.ts): the
 * ownership branch (`customerId` match) is that same function's other,
 * already-hardened authorization path, not a new/weaker check. `token`
 * is always null here — a logged-in customer is authorized by their own
 * session, never by a capability token from a URL.
 */
export default async function AccountOrderDetailPage({
  params,
}: {
  params: Promise<{ number: string }>;
}) {
  const { number } = await params;

  const session = await getCustomerSession();
  // F-131: src/proxy.ts already redirects a signed-out request straight
  // here before this ever renders — this per-page redirect only matters
  // for a cookie that exists but no longer verifies, and must carry the
  // order number the shopper actually asked for, not the bare list.
  if (!session) redirect(`/account/login?returnTo=${encodeURIComponent(`/account/orders/${number}`)}`);

  const requestHeaders = await headers();
  const ip = getClientIp({ headers: requestHeaders } as unknown as Request);
  if (ip !== null) {
    const rateLimit = await checkRateLimit(
      `account-order-page:${ip}`,
      ACCOUNT_ORDER_PAGE_RATE_LIMIT,
      ACCOUNT_ORDER_PAGE_RATE_WINDOW_MS,
    );
    if (!rateLimit.ok) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-24 text-center">
          <h2 className="font-display text-2xl font-bold text-ink">Too many requests</h2>
          <p className="mt-2 text-muted">You&rsquo;ve checked this a few too many times in a row — please wait a minute and try again.</p>
        </div>
      );
    }
  }

  const order = await getAuthorizedOrder({ number, token: null, customerId: session.id });
  if (!order) notFound();

  const address = order.shippingAddress as unknown as ShippingAddressInput;
  // F-141 fix: see getOrderTimeline's doc comment — only matters for a
  // RAZORPAY order that never captured a payment.
  // F-300 fix: the real timestamp columns date each step (in IST) and
  // decide which post-shipping steps a returned/refunded order can claim.
  const timeline = getOrderTimeline(order.status, order.paymentMethod, order.razorpayPaymentId !== null, {
    placedAt: order.createdAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
  });
  // F-300 fix: "Write a review" is hidden once the customer already has
  // one for that product (Review has @@unique([productId, customerId])) —
  // one batched query for every product this delivered order shipped,
  // rather than one query per line.
  const deliveredProductIds =
    order.status === "DELIVERED"
      ? Array.from(new Set(order.items.map((item) => item.variant?.productId).filter((id): id is string => Boolean(id))))
      : [];
  const reviewedProductIds =
    deliveredProductIds.length > 0
      ? new Set(
          (
            await db.review.findMany({
              where: { customerId: session.id, productId: { in: deliveredProductIds } },
              select: { productId: true },
            })
          ).map((review) => review.productId),
        )
      : new Set<string>();
  // F-328: same receipt facts (date, payment status, seller) the guest
  // /order/[number] page shows — see src/lib/orders/receipt.ts.
  const placedDate = formatReceiptDate(order.createdAt);
  const paymentSummary = getReceiptPaymentSummary(
    order.status,
    order.paymentMethod,
    order.razorpayPaymentId !== null,
    order.paidAt !== null,
  );
  const [gstin, sellerAddress] = await Promise.all([
    getSetting("legal.gstin"),
    getSetting("contact.address"),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/account/orders" className="text-xs font-semibold text-brand hover:underline print:hidden">
        ← Back to Orders
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-ink">{order.number}</h2>
          <p className="text-sm text-muted">
            Placed {placedDate} · {paymentSummary}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <OrderStatusBadge status={order.status} paymentMethod={order.paymentMethod} paid={order.paidAt !== null} />
          <OrderPrintButton />
        </div>
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-surface p-5 print:hidden">
        <h2 className="mb-4 font-display text-lg font-bold text-ink">Order status</h2>
        <OrderTimelineView timeline={timeline} />
      </section>

      <section className="mt-6 space-y-4 print:break-inside-avoid">
        <h2 className="font-display text-lg font-bold text-ink">Items</h2>
        <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {order.items.map((item) => {
            // F-300 fix: a delivered order's items were plain text — no
            // link to the product, no way to review it or buy it again.
            // `variant` (and so `productHref`) is null for an item whose
            // variant was later deleted — it still renders, just with no
            // link/CTA, same as any other "product no longer exists" case.
            const productHref = item.variant?.product.status === "ACTIVE" ? `/products/${item.variant.product.slug}` : null;
            const canBuyAgain =
              order.status === "DELIVERED" &&
              item.variant !== null &&
              item.variant.active &&
              item.variant.stock > 0 &&
              item.variant.product.status === "ACTIVE";
            const reviewHref = productHref ? `${productHref}#reviews` : null;
            const canReview =
              order.status === "DELIVERED" &&
              item.variant !== null &&
              reviewHref !== null &&
              !reviewedProductIds.has(item.variant.productId);
            return (
              <div key={item.id} className="flex items-center gap-4 p-4">
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-lavender/40">
                  {item.imageUrl ? (
                    productHref ? (
                      <Link href={productHref}>
                        <Image src={item.imageUrl} alt={item.productName} fill className="object-cover" sizes="64px" />
                      </Link>
                    ) : (
                      <Image src={item.imageUrl} alt={item.productName} fill className="object-cover" sizes="64px" />
                    )
                  ) : null}
                </div>
                <div className="flex-1">
                  {productHref ? (
                    <Link href={productHref} className="font-semibold text-ink hover:underline">
                      {item.productName}
                    </Link>
                  ) : (
                    <p className="font-semibold text-ink">{item.productName}</p>
                  )}
                  {item.variantLabel && <p className="text-sm text-muted">{item.variantLabel}</p>}
                  <p className="text-sm text-muted">Qty {item.quantity}</p>
                  {(canReview || canBuyAgain) && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 print:hidden">
                      {canReview && reviewHref && (
                        <Link href={reviewHref} className="text-xs font-semibold text-brand hover:underline">
                          Write a review
                        </Link>
                      )}
                      {canBuyAgain && item.variant && (
                        <BuyAgainButton
                          variantId={item.variant.id}
                          productHandle={item.variant.product.slug}
                          productTitle={item.productName}
                          variantTitle={item.variantLabel}
                          price={item.variant.price !== null ? Number(item.variant.price) : Number(item.variant.product.price)}
                          image={item.imageUrl}
                          quantity={item.quantity}
                          stock={item.variant.stock}
                        />
                      )}
                    </div>
                  )}
                </div>
                <p className="font-semibold text-ink">{formatInr(Number(item.unitPrice) * item.quantity)}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6 space-y-1 rounded-2xl border border-border bg-surface p-4 text-sm print:break-inside-avoid">
        <div className="flex justify-between">
          <span className="text-muted">Subtotal</span>
          <span className="text-ink">{formatInr(Number(order.subtotal))}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Shipping</span>
          <span className="text-ink">{Number(order.shipping) === 0 ? "Free" : formatInr(Number(order.shipping))}</span>
        </div>
        {Number(order.discount) > 0 && (
          <div className="flex justify-between">
            <span className="text-muted">Discount</span>
            <span className="text-ink">-{formatInr(Number(order.discount))}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-display text-lg font-bold">
          <span className="text-ink">Total</span>
          <span className="text-ink">{formatInr(Number(order.total))}</span>
        </div>
      </section>

      {order.trackingNumber && (
        <div className="mt-6 print:hidden">
          <OrderTrackingCard trackingNumber={order.trackingNumber} courier={order.courier} />
        </div>
      )}

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm print:break-inside-avoid">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Shipping to</h2>
        <p className="text-ink">{address?.name}</p>
        <p className="text-muted">
          {address?.line1}
          {address?.line2 ? `, ${address.line2}` : ""}
        </p>
        <p className="text-muted">
          {address?.city}, {address?.state} {address?.pincode}
        </p>
        <p className="text-muted">{address?.country === "IN" ? "India" : address?.country}</p>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm print:break-inside-avoid">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Payment method</h2>
        <p className="text-ink">{paymentSummary}</p>
      </section>

      {/* F-328: seller identity block for the printed receipt — same
          settings-driven, hide-when-blank facts the guest /order/[number]
          page and the admin invoice page show. */}
      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm print:break-inside-avoid">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Sold by</h2>
        <p className="font-semibold text-ink">{brand.legalName}</p>
        {sellerAddress && <p className="text-muted">{sellerAddress}</p>}
        {gstin && <p className="text-muted">GSTIN {gstin}</p>}
      </section>
    </div>
  );
}
