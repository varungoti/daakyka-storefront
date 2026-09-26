import { OrderTimelineView } from "@/components/account/order-timeline";
import { OrderTrackingCard } from "@/components/account/order-tracking-card";
import { brand } from "@/data/brand";
import { getCustomerSession } from "@/lib/customer-auth/session";
import type { OrderStatus } from "@/generated/prisma/client";
import { checkOrderPageRateLimit, getAuthorizedOrder } from "@/lib/orders/get-order";
import { getOrderTimeline } from "@/lib/orders/timeline";
import { getClientIp } from "@/lib/security/rate-limit";
import { getSetting } from "@/lib/settings";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import { CheckCircle2, Loader2, RotateCcw, Truck, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Order Confirmation",
  robots: { index: false, follow: false },
};

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

const STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

/**
 * F-067 fix: this heading used to be a hard-coded "Order confirmed" with a
 * check icon for every status, including CANCELLED and REFUNDED — actively
 * misleading, not just a missing feature. Mirrors getOrderTimeline's own
 * per-status framing (src/lib/orders/timeline.ts) at the top of the page.
 */
function getStatusHero(status: OrderStatus): { Icon: typeof CheckCircle2; label: string } {
  switch (status) {
    case "SHIPPED":
      return { Icon: Truck, label: "Order shipped" };
    case "DELIVERED":
      return { Icon: CheckCircle2, label: "Order delivered" };
    case "CANCELLED":
      return { Icon: XCircle, label: "Order cancelled" };
    case "REFUNDED":
      return { Icon: RotateCcw, label: "Order refunded" };
    default:
      return { Icon: CheckCircle2, label: "Order confirmed" };
  }
}

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
  const gstin = await getSetting("legal.gstin");

  // Audit F-281: reached right after Razorpay reported a successful
  // payment but this session's own POST /api/checkout/verify couldn't
  // confirm it (a network blip, a transient error, or the webhook simply
  // hasn't landed yet — see checkout-page-content.tsx's openRazorpayCheckout).
  // The order really may still be PENDING_PAYMENT at this exact moment;
  // showing "Awaiting payment" here would read as "you haven't paid",
  // inviting the shopper to pay again for a charge that already went
  // through.
  const isConfirmingPayment = order.status === "PENDING_PAYMENT" && payment === "confirming";
  const hero = getStatusHero(order.status);
  // F-141 fix precedent (src/lib/orders/timeline.ts): only matters for a
  // RAZORPAY order's CANCELLED wording — see that function's doc comment.
  const timeline = getOrderTimeline(order.status, order.paymentMethod, order.razorpayPaymentId !== null);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
      <div className="flex items-center gap-3 text-brand">
        {isConfirmingPayment ? <Loader2 size={32} className="animate-spin" /> : <hero.Icon size={32} />}
        <h1 className="font-display text-3xl font-bold text-ink">
          {isConfirmingPayment ? "Payment received — confirming" : hero.label}
        </h1>
      </div>
      <p className="mt-2 text-muted">
        Order <span className="font-semibold text-ink">{order.number}</span> — status:{" "}
        <span className="font-semibold text-ink">
          {isConfirmingPayment ? "Confirming payment" : (STATUS_LABELS[order.status] ?? order.status)}
        </span>
      </p>

      {isConfirmingPayment && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm text-ink">
          <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin" />
          <p>
            We&rsquo;ve received your payment and are confirming it — this can take a minute. Please don&rsquo;t
            place the order again. If this doesn&rsquo;t update soon, contact us with your order number{" "}
            <span className="font-semibold">{order.number}</span>.
          </p>
        </div>
      )}

      {!isConfirmingPayment && (
        <section className="mt-8 rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-4 font-display text-lg font-bold text-ink">Order status</h2>
          <OrderTimelineView timeline={timeline} />
        </section>
      )}

      {!isConfirmingPayment && order.trackingNumber && (
        <div className="mt-6">
          <OrderTrackingCard trackingNumber={order.trackingNumber} courier={order.courier} />
        </div>
      )}

      <section className="mt-8 space-y-4">
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

      <section className="mt-6 space-y-1 rounded-2xl border border-border bg-surface p-4 text-sm">
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

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm">
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
    </div>
  );
}
