import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { OrderTimelineView } from "@/components/account/order-timeline";
import { OrderTrackingCard } from "@/components/account/order-tracking-card";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { getAuthorizedOrder } from "@/lib/orders/get-order";
import { getOrderTimeline } from "@/lib/orders/timeline";
import { getClientIp, checkRateLimit } from "@/lib/security/rate-limit";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

export const metadata: Metadata = { title: "Order Details" };

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount,
  );
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
  const session = await getCustomerSession();
  if (!session) redirect("/account/login?returnTo=/account/orders");

  const { number } = await params;

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
          <h1 className="font-display text-2xl font-bold text-ink">Too many requests</h1>
          <p className="mt-2 text-muted">You&rsquo;ve checked this a few too many times in a row — please wait a minute and try again.</p>
        </div>
      );
    }
  }

  const order = await getAuthorizedOrder({ number, token: null, customerId: session.id });
  if (!order) notFound();

  const address = order.shippingAddress as unknown as ShippingAddressInput;
  const timeline = getOrderTimeline(order.status, order.paymentMethod);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/account/orders" className="text-xs font-semibold text-brand hover:underline">
        ← Back to Orders
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{order.number}</h1>
          <p className="text-sm text-muted">
            Placed{" "}
            {order.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <OrderStatusBadge status={order.status} paymentMethod={order.paymentMethod} />
      </div>

      <section className="mt-8 rounded-2xl border border-border bg-surface p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-ink">Order status</h2>
        <OrderTimelineView timeline={timeline} />
      </section>

      <section className="mt-6 space-y-4">
        <h2 className="font-display text-lg font-bold text-ink">Items</h2>
        <div className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {order.items.map((item) => (
            <div key={item.id} className="flex items-center gap-4 p-4">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-lavender/40">
                {item.imageUrl ? (
                  <Image src={item.imageUrl} alt={item.productName} fill className="object-cover" sizes="64px" />
                ) : null}
              </div>
              <div className="flex-1">
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
        <div className="mt-6">
          <OrderTrackingCard trackingNumber={order.trackingNumber} courier={order.courier} />
        </div>
      )}

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

      <section className="mt-6 rounded-2xl border border-border bg-surface p-4 text-sm">
        <h2 className="mb-2 font-display text-lg font-bold text-ink">Payment method</h2>
        <p className="text-ink">
          {order.paymentMethod === "RAZORPAY" ? "Razorpay" : "Order Request (manual invoice)"}
        </p>
      </section>
    </div>
  );
}
