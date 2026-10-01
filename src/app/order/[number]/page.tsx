import { OrderPrintButton } from "@/components/account/order-print-button";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { OrderTimelineView } from "@/components/account/order-timeline";
import { OrderTrackingCard } from "@/components/account/order-tracking-card";
import { brand } from "@/data/brand";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { checkOrderPageRateLimit, getAuthorizedOrder } from "@/lib/orders/get-order";
import { formatReceiptDate, getReceiptPaymentSummary } from "@/lib/orders/receipt";
import { getOrderStatusHero, getOrderTimeline, type OrderStatusHeroIcon } from "@/lib/orders/timeline";
import { getClientIp } from "@/lib/security/rate-limit";
import { getSetting } from "@/lib/settings";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import { buttonClassNames } from "@/components/ui/button";
import { CheckCircle2, Clock, Loader2, RotateCcw, Truck, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

// F-120 fix: neutral title — this page is also where a cancelled, refunded
// or still-unpaid order lands, so "Order Confirmation" would be wrong for
// those. No order number here: this is metadata a link unfurler could cache.
export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
};

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * F-067 / F-120 fix: the heading used to be a hard-coded "Order confirmed"
 * with a check icon for every status, including CANCELLED, REFUNDED and an
 * order still awaiting payment — actively misleading, not just a missing
 * feature. getOrderStatusHero (src/lib/orders/timeline.ts) picks the
 * per-status wording and is what's unit-tested; this only maps its icon
 * key to a component, with a colour that doesn't read as success for a
 * cancelled or refunded order.
 */
const HERO_ICONS: Record<OrderStatusHeroIcon, { Icon: typeof CheckCircle2; className: string }> = {
  clock: { Icon: Clock, className: "text-brand" },
  check: { Icon: CheckCircle2, className: "text-brand" },
  truck: { Icon: Truck, className: "text-brand" },
  cancelled: { Icon: XCircle, className: "text-red-600" },
  refunded: { Icon: RotateCcw, className: "text-amber-700" },
};

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ token?: string; sig?: string; payment?: string }>;
}) {
  const { number } = await params;
  // F-284 fix: `sig` is the stateless fallback the Razorpay webhook's
  // email links to when it (not /api/checkout/verify) is the one that
  // confirms payment — see signOrderLink's doc comment
  // (src/lib/orders/access-token.ts). Accepted alongside `token`;
  // getAuthorizedOrder tries both.
  const { token, sig, payment } = await searchParams;

  // Rate-limited before anything else touches the DB: an unauthenticated,
  // guessable-by-design URL (see get-order.ts's doc comment on finding F2)
  // must never let enumeration run unthrottled, no matter how large the
  // order-number keyspace is. getClientIp only ever reads
  // `request.headers.get(...)`, so a minimal object exposing just
  // `.headers` (from next/headers's headers(), which isn't itself a
  // Request) satisfies it at runtime — `unknown` is required as an
  // intermediate cast because the object literal doesn't structurally
  // match the full Request interface.
  const requestHeaders = await headers();
  const ip = getClientIp({ headers: requestHeaders } as unknown as Request);
  const rateLimit = await checkOrderPageRateLimit(ip);
  if (!rateLimit.ok) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center lg:px-8">
        <h1 className="font-display text-2xl font-bold text-ink">Too many requests</h1>
        <p className="mt-2 text-muted">
          You&rsquo;ve checked this a few too many times in a row — please wait a minute and try again.
        </p>
      </div>
    );
  }

  const session = await getCustomerSession();
  const order = await getAuthorizedOrder({
    number,
    token: token ?? null,
    sig: sig ?? null,
    customerId: session?.id ?? null,
  });
  if (!order) notFound();

  const address = order.shippingAddress as unknown as ShippingAddressInput;
  // F-125: no page in the money path stated whether prices include tax, or
  // named the seller/GSTIN — settings-driven so the GSTIN line is hidden
  // (not a placeholder) until the owner has actually registered for GST.
  // F-328: sellerAddress is fetched alongside for the printed-receipt
  // "Sold by" block below — same settings-driven, hide-when-blank pattern
  // the admin invoice page already uses
  // (src/app/admin/(panel)/orders/[id]/invoice/page.tsx).
  const [gstin, sellerAddress] = await Promise.all([
    getSetting("legal.gstin"),
    getSetting("contact.address"),
  ]);

  // Audit F-281: reached right after Razorpay reported a successful
  // payment but this session's own POST /api/checkout/verify couldn't
  // confirm it (a network blip, a transient error, or the webhook simply
  // hasn't landed yet — see checkout-page-content.tsx's openRazorpayCheckout).
  // The order really may still be PENDING_PAYMENT at this exact moment;
  // showing "Awaiting payment" here would read as "you haven't paid",
  // inviting the shopper to pay again for a charge that already went
  // through.
  const isConfirmingPayment = order.status === "PENDING_PAYMENT" && payment === "confirming";
  const hero = getOrderStatusHero(order.status, order.paymentMethod, order.paidAt !== null);
  const { Icon: HeroIcon, className: heroIconClass } = HERO_ICONS[hero.icon];
  // F-141 fix precedent (src/lib/orders/timeline.ts): only matters for a
  // RAZORPAY order's CANCELLED wording — see that function's doc comment.
  // The real timestamp columns date each step and decide which
  // post-shipping steps a returned/refunded order can claim.
  const timeline = getOrderTimeline(order.status, order.paymentMethod, order.razorpayPaymentId !== null, {
    placedAt: order.createdAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
  });
  // F-328: the receipt's own "Placed <date>" / payment-status line — see
  // src/lib/orders/receipt.ts for why these are pure, separately-tested
  // helpers rather than inline JSX logic.
  const placedDate = formatReceiptDate(order.createdAt);
  const paymentSummary = getReceiptPaymentSummary(
    order.status,
    order.paymentMethod,
    order.razorpayPaymentId !== null,
    order.paidAt !== null,
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            {isConfirmingPayment ? (
              <Loader2 size={32} className="animate-spin text-brand" />
            ) : (
              <HeroIcon size={32} className={heroIconClass} />
            )}
            <h1 className="font-display text-3xl font-bold text-ink">
              {isConfirmingPayment ? "Payment received — confirming" : hero.label}
            </h1>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            <span>
              Order <span className="font-semibold text-ink">{order.number}</span> — status:
            </span>
            {/* F-120 fix: the shared badge (not a local label map) so this
                page reads the same as the account order pages — in
                particular "Order Received" for an unconfirmed
                ORDER_REQUEST order rather than a bare "Processing". */}
            {isConfirmingPayment ? (
              <span className="font-semibold text-ink">Confirming payment</span>
            ) : (
              <OrderStatusBadge status={order.status} paymentMethod={order.paymentMethod} paid={order.paidAt !== null} />
            )}
          </p>
          {/* F-328: order date + payment status — a printed receipt with
              neither was one of this finding's core gaps. Skipped while
              still confirming a just-completed payment, same condition as
              the order-status section below: the underlying facts (paid?
              when?) aren't settled yet. */}
          {!isConfirmingPayment && (
            <p className="mt-1 text-sm text-muted">
              Placed {placedDate} · {paymentSummary}
            </p>
          )}
        </div>
        {/* F-328: itself print:hidden (see OrderPrintButton) — the only
            on-page control meant to survive onto the printed receipt is
            the receipt content itself. */}
        {!isConfirmingPayment && <OrderPrintButton />}
      </div>

      {/* F-328: none of this "what's happening" chrome belongs on a printed
          receipt — it's transient/decorative, not one of the receipt facts
          (date, payment, items, totals, shipping, seller) the finding asks
          for, so it's print:hidden the same way the site chrome is. */}
      {isConfirmingPayment && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm text-ink print:hidden">
          <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin" />
          <p>
            We&rsquo;ve received your payment and are confirming it — this can take a minute. Please don&rsquo;t
            place the order again. If this doesn&rsquo;t update soon, contact us with your order number{" "}
            <span className="font-semibold">{order.number}</span>.
          </p>
        </div>
      )}

      {!isConfirmingPayment && (
        <section className="mt-8 rounded-2xl border border-border bg-surface p-5 print:hidden">
          <h2 className="mb-4 font-display text-lg font-bold text-ink">Order status</h2>
          <OrderTimelineView timeline={timeline} />
        </section>
      )}

      {!isConfirmingPayment && order.trackingNumber && (
        <div className="mt-6 print:hidden">
          <OrderTrackingCard trackingNumber={order.trackingNumber} courier={order.courier} />
        </div>
      )}

      {/* F-120 fix: this page used to be a dead end — no way onward once a
          shopper had read their order status. "View my orders" only for a
          signed-in shopper (a guest has no account order list to send them
          to); "Continue shopping" always. */}
      {!isConfirmingPayment && (
        <div className="mt-6 flex flex-wrap gap-3 print:hidden">
          <Link href="/shop" className={buttonClassNames({ variant: "outline", size: "sm" })}>
            Continue shopping
          </Link>
          {session && (
            <Link href="/account/orders" className={buttonClassNames({ variant: "ghost", size: "sm" })}>
              View my orders
            </Link>
          )}
        </div>
      )}

      <section className="mt-8 space-y-4 print:break-inside-avoid">
        <h2 className="font-display text-lg font-bold text-ink">Items</h2>
        <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-semibold text-ink">{item.productName}</p>
                {item.variantLabel && <p className="text-sm text-muted">{item.variantLabel}</p>}
                <p className="text-sm text-muted">Qty {item.quantity}</p>
              </div>
              <p className="font-semibold text-ink">{formatInr(Number(item.unitPrice) * item.quantity)}</p>
            </div>
          ))}
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
            <span className="text-muted">Discount{order.discountCode ? ` (${order.discountCode})` : ""}</span>
            <span className="text-ink">-{formatInr(Number(order.discount))}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-display text-lg font-bold">
          <span className="text-ink">Total</span>
          <span className="text-ink">{formatInr(Number(order.total))}</span>
        </div>
        <p className="pt-1 text-right text-xs text-muted">
          Inclusive of all taxes · Sold by {brand.legalName}
          {gstin ? ` · GSTIN ${gstin}` : ""}
        </p>
      </section>

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

      {/* F-328: the receipt's seller block — legal name, address and GSTIN
          (when set), the same settings-driven, hide-when-blank facts the
          admin invoice page shows (src/app/admin/(panel)/orders/[id]/invoice/page.tsx).
          Distinct from the one-line "Sold by" tax disclosure above (F-125):
          that line exists to state tax-inclusivity next to the total, this
          section is the actual seller identity a printed receipt needs. */}
      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm print:break-inside-avoid">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Sold by</h2>
        <p className="font-semibold text-ink">{brand.legalName}</p>
        {sellerAddress && <p className="text-muted">{sellerAddress}</p>}
        {gstin && <p className="text-muted">GSTIN {gstin}</p>}
      </section>
    </div>
  );
}
