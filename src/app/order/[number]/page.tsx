import { getCustomerSession } from "@/lib/customer-auth/session";
import { checkOrderPageRateLimit, getAuthorizedOrder } from "@/lib/orders/get-order";
import { getClientIp } from "@/lib/security/rate-limit";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import { CheckCircle2, Truck } from "lucide-react";
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

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { number } = await params;
  const { token } = await searchParams;

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
  const order = await getAuthorizedOrder({ number, token: token ?? null, customerId: session?.id ?? null });
  if (!order) notFound();

  const address = order.shippingAddress as unknown as ShippingAddressInput;

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 lg:px-8">
      <div className="flex items-center gap-3 text-brand">
        <CheckCircle2 size={32} />
        <h1 className="font-display text-3xl font-bold text-ink">Order confirmed</h1>
      </div>
      <p className="mt-2 text-muted">
        Order <span className="font-semibold text-ink">{order.number}</span> — status:{" "}
        <span className="font-semibold text-ink">{STATUS_LABELS[order.status] ?? order.status}</span>
      </p>

      {order.paymentMethod === "ORDER_REQUEST" && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-accent/40 bg-accent/10 p-4 text-sm text-ink">
          <Truck size={20} className="mt-0.5 shrink-0" />
          <p>Our team will contact you shortly to confirm payment and delivery for this order.</p>
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
            <span className="text-muted">Discount</span>
            <span className="text-ink">-{formatInr(Number(order.discount))}</span>
          </div>
        )}
        <div className="mt-2 flex justify-between border-t border-border pt-2 font-display text-lg font-bold">
          <span className="text-ink">Total</span>
          <span className="text-ink">{formatInr(Number(order.total))}</span>
        </div>
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
