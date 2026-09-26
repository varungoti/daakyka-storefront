import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getOrderForAdmin, getOrderHistory, OrderNotFoundError } from "@/lib/orders/admin-orders";
import { OrderDetailActions } from "@/components/admin/order-detail-actions";
import { BackToOrdersLink } from "@/components/admin/back-to-orders-link";
import { OrderTimeline } from "@/components/admin/order-timeline";
import { formatInrExact } from "@/lib/currency/admin-money";
import type { ShippingAddressInput } from "@/lib/validation/schemas";

// F-202 fix: was `maximumFractionDigits: 0`, which silently rounded a
// paise total (any percentage-discount order) to the nearest whole rupee
// — see src/lib/currency/admin-money.ts.
function formatInr(amount: number): string {
  return formatInrExact(amount);
}

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "orders:view")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;
  const [order, history] = await Promise.all([
    getOrderForAdmin(id).catch((err) => {
      if (err instanceof OrderNotFoundError) return null;
      throw err;
    }),
    // F-205 fix: fetched alongside the order rather than after it, so this
    // page makes one round trip instead of two. A bogus `id` just means no
    // AuditLog rows match (an empty timeline) — the `notFound()` below
    // still fires from the order lookup regardless.
    getOrderHistory(id).catch(() => []),
  ]);
  if (!order) notFound();

  const address = order.shippingAddress as unknown as ShippingAddressInput | null;
  const canManage = hasPermission(session.role, "orders:manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <BackToOrdersLink />
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">{order.number}</h1>
          <p className="text-muted">
            Placed {order.createdAt.toLocaleString("en-IN")} · Last updated {order.updatedAt.toLocaleString("en-IN")}
          </p>
        </div>
        <Link
          href={`/admin/orders/${order.id}/invoice`}
          target="_blank"
          className="rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-lavender/30"
        >
          View invoice
        </Link>
      </div>

      {/* F-069 fix: `grid-cols-1` (not the bare `grid`, which leaves an
          implicit auto/1fr track below `lg`) is load-bearing here, not
          decorative — an implicit track sizes to its content's
          *min-content* width, and the Items row below has an unbreakable
          SKU that used to force that min-content past the viewport,
          widening this whole grid (and every card in it) off the right
          edge on a phone. `min-w-0` on both columns closes the same hole
          for any other long unbroken string (a product name, an email) —
          see admin-shell.tsx's near-identical `min-w-0` comment on its own
          flex column, same underlying CSS sizing rule. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-4 font-display text-lg font-bold text-ink">Items</h2>
            <div className="divide-y divide-border">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-4 py-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-lavender/40">
                    {item.imageUrl ? <Image src={item.imageUrl} alt={item.productName} fill className="object-cover" sizes="56px" /> : null}
                  </div>
                  {/* min-w-0 alone doesn't stop this flex item from
                      widening its grid ancestor — the SKU also needs a
                      wrap rule, since `min-width: 0` only allows *this box*
                      to shrink; it doesn't make the unbreakable text inside
                      it wrap. break-all matches the Razorpay id treatment
                      below. */}
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-semibold text-ink">{item.productName}</p>
                    <p className="break-all text-xs text-muted">
                      {item.variantLabel ?? "—"} {item.sku ? `· SKU ${item.sku}` : ""}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm text-muted">Qty {item.quantity}</p>
                  <p className="w-24 shrink-0 text-right font-semibold text-ink">{formatInr(item.unitPrice * item.quantity)}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Subtotal</span>
                <span className="text-ink">{formatInr(order.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Shipping</span>
                <span className="text-ink">{order.shipping === 0 ? "Free" : formatInr(order.shipping)}</span>
              </div>
              {order.discount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted">Discount{order.discountCode ? ` (${order.discountCode})` : ""}</span>
                  <span className="text-ink">-{formatInr(order.discount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 font-display text-lg font-bold">
                <span className="text-ink">Total</span>
                <span className="text-ink">{formatInr(order.total)}</span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-display text-lg font-bold text-ink">Shipping address</h2>
            {address ? (
              <div className="text-sm text-ink">
                <p>{address.name}</p>
                <p className="text-muted">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}
                </p>
                <p className="text-muted">
                  {address.city}, {address.state} {address.pincode}
                </p>
                <p className="text-muted">{address.country === "IN" ? "India" : address.country}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">No address on file.</p>
            )}
          </section>

          {/* F-205 fix: the page used to show no history at all — only
              "Placed … · Last updated …" above — even though every status
              change, tracking update and notes edit is already recorded in
              AuditLog by updateOrderAdmin. */}
          <OrderTimeline placedAt={order.createdAt.toISOString()} entries={history} />
        </div>

        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-display text-lg font-bold text-ink">Customer</h2>
            <div className="text-sm">
              <p className="font-semibold text-ink">
                {order.customerName ?? order.guestName ?? "Guest checkout"}
              </p>
              {!order.customerId && (
                <p className="text-xs text-muted">Guest checkout — not a registered account</p>
              )}
              <p className="break-all text-muted">{order.email}</p>
              {order.phone && <p className="text-muted">{order.phone}</p>}
              {order.customerId && (
                <Link href={`/admin/customers/${order.customerId}`} className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                  View customer →
                </Link>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-display text-lg font-bold text-ink">Payment</h2>
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted">Method: </span>
                <span className="text-ink">{order.paymentMethod === "RAZORPAY" ? "Razorpay" : "Order Request"}</span>
              </p>
              {order.razorpayOrderId && (
                <p className="break-all">
                  <span className="text-muted">Razorpay order: </span>
                  <span className="text-ink">{order.razorpayOrderId}</span>
                </p>
              )}
              {order.razorpayPaymentId && (
                <p className="break-all">
                  <span className="text-muted">Payment ID: </span>
                  <span className="text-ink">{order.razorpayPaymentId}</span>
                </p>
              )}
              {order.razorpayPaymentUrl && (
                <a
                  href={order.razorpayPaymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-xs font-semibold text-brand hover:underline"
                >
                  Open in Razorpay dashboard →
                </a>
              )}
              {!order.razorpayOrderId && !order.razorpayPaymentId && <p className="text-muted">No online payment on this order.</p>}
            </div>
            {order.paymentMethod === "ORDER_REQUEST" && (
              <p className="mt-3 rounded-xl bg-lavender/30 p-3 text-xs text-muted">
                {order.status === "CANCELLED"
                  ? "This unpaid order request was cancelled — the stock it had reserved was restored to inventory."
                  : order.status === "SHIPPED" || order.status === "DELIVERED"
                    ? "Stock for this unpaid order request was decremented at checkout and has already shipped."
                    : "This is an unpaid order request: stock was decremented at checkout (no online payment step). Cancelling it will restore that stock to inventory."}
              </p>
            )}
            {order.paymentMethod === "RAZORPAY" && order.razorpayPaymentId && (
              <p className="mt-3 rounded-xl bg-lavender/30 p-3 text-xs text-muted">
                {order.status === "CANCELLED" || order.status === "REFUNDED"
                  ? "Stock (and any discount code use) taken when this order was paid has been restored to inventory. Cancelling or refunding never moves money — see the Razorpay dashboard link above."
                  : "Stock for this order was decremented, and any discount code use committed, when payment was verified — not at checkout. Cancelling or refunding it here never moves money; refund the payment in Razorpay first."}
              </p>
            )}
          </section>

          <OrderDetailActions
            orderId={order.id}
            currentStatus={order.status}
            trackingNumber={order.trackingNumber}
            courier={order.courier}
            adminNotes={order.adminNotes}
            canManage={canManage}
            paymentMethod={order.paymentMethod}
            hasCapturedPayment={order.razorpayPaymentId !== null}
            razorpayPaymentUrl={order.razorpayPaymentUrl}
            updatedAt={order.updatedAt.toISOString()}
          />
        </div>
      </div>
    </div>
  );
}
