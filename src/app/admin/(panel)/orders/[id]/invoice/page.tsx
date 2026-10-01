import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getOrderForAdmin, OrderNotFoundError } from "@/lib/orders/admin-orders";
import { formatDateIST } from "@/lib/format/datetime";
import { ensureInvoiceNumber } from "@/lib/orders/invoice-number";
import { getInvoiceDocument } from "@/lib/orders/invoice-document";
import { getSetting } from "@/lib/settings";
import { brand } from "@/data/brand";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import { InvoicePrintButton } from "@/components/admin/invoice-print-button";

// F-195: was `maximumFractionDigits: 0`, which silently rounded paise off
// a printed financial document — a real order can have a fractional total
// (a percentage discount, e.g. src/lib/discounts/index.ts's 2dp rounding),
// so a printed "₹432" for an order actually charged 432.33 doesn't match
// what Razorpay took. Always shows both decimals instead.
function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Phase D4: simple HTML-to-print invoice — no PDF generation, just a
 * print-friendly layout and a "Print" button that calls window.print().
 * `orders:view` is enough to view/print, matching the plan.
 */
export default async function AdminOrderInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "orders:view")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;
  const order = await getOrderForAdmin(id).catch((err) => {
    if (err instanceof OrderNotFoundError) return null;
    throw err;
  });
  if (!order) notFound();

  const address = order.shippingAddress as unknown as ShippingAddressInput | null;
  const [phone, email, addressLine, gstin] = await Promise.all([
    getSetting("contact.phone"),
    getSetting("contact.email"),
    getSetting("contact.address"),
    getSetting("legal.gstin"),
  ]);
  // F-195: assigned lazily, the first time this page is actually opened for
  // an order that's reached a real "this was sold" status — see
  // ensureInvoiceNumber's own doc comment for why it isn't done at the
  // PAID-transition call site instead.
  const invoiceNumber = await ensureInvoiceNumber(order.id);
  // F-195 / F-199: the title (and, for a cancelled/refunded/returned order,
  // the warning banner) must say what the document actually is — see
  // getInvoiceDocument.
  const invoiceDoc = getInvoiceDocument(order.status, Boolean(gstin), {
    invoiceNumber,
    shipped: order.shippedAt !== null,
  });
  // Best-effort place of supply from the free-text shipping-address state
  // — see this file's own note on the tax-breakup limitation below.
  const placeOfSupply = address?.state ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex justify-end print:hidden">
        <InvoicePrintButton />
      </div>

      <div className="rounded-2xl border border-border bg-white p-8 text-ink print:rounded-none print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b border-border pb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">{brand.name}</h1>
            <p className="text-sm text-muted">{brand.legalName}</p>
            <p className="mt-2 text-xs text-muted">{addressLine}</p>
            <p className="text-xs text-muted">
              {phone} · {email}
            </p>
            {/* F-195: hidden, not a placeholder, until the owner has
                actually registered and entered a GSTIN in Settings. */}
            {gstin && <p className="mt-1 text-xs font-semibold text-ink">GSTIN: {gstin}</p>}
          </div>
          <div className="text-right">
            <h2 className="font-display text-xl font-bold">{invoiceDoc.heading}</h2>
            <p className="text-sm text-muted">Order {order.number}</p>
            {invoiceNumber && <p className="text-sm text-muted">Invoice No. {invoiceNumber}</p>}
            <p className="text-sm text-muted">{formatDateIST(order.createdAt)}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">{order.status.replace("_", " ")}</p>
            {placeOfSupply && <p className="mt-1 text-xs text-muted">Place of supply: {placeOfSupply}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 border-b border-border py-6">
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Billed to</h3>
            <p className="font-semibold">{order.customerName ?? address?.name ?? "Guest"}</p>
            <p className="text-sm text-muted">{order.email}</p>
            {order.phone && <p className="text-sm text-muted">{order.phone}</p>}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Ship to</h3>
            {address ? (
              <>
                <p className="text-sm">{address.name}</p>
                <p className="text-sm text-muted">
                  {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}
                </p>
                <p className="text-sm text-muted">
                  {address.city}, {address.state} {address.pincode}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2">Item</th>
              <th className="py-2">SKU</th>
              {/* F-195: HSN is read live from the product, not snapshotted
                  on the order line — see admin-orders.ts's ORDER_DETAIL_INCLUDE
                  comment. */}
              <th className="py-2">HSN</th>
              <th className="py-2 text-right">Qty</th>
              <th className="py-2 text-right">Unit price</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-border/60">
                <td className="py-2">
                  <p className="font-medium">{item.productName}</p>
                  {item.variantLabel && <p className="text-xs text-muted">{item.variantLabel}</p>}
                </td>
                <td className="py-2 text-muted">{item.sku ?? "—"}</td>
                <td className="py-2 text-muted">{item.hsnCode ?? "—"}</td>
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{formatInr(item.unitPrice)}</td>
                <td className="py-2 text-right">{formatInr(Math.round(item.unitPrice * item.quantity * 100) / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-4 w-64 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">Subtotal</span>
            <span>{formatInr(order.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Shipping</span>
            <span>{order.shipping === 0 ? "Free" : formatInr(order.shipping)}</span>
          </div>
          {order.discount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted">Discount</span>
              <span>-{formatInr(order.discount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
            <span>Total</span>
            <span>{formatInr(order.total)}</span>
          </div>
          {/* F-125/F-195: a per-line CGST/SGST/IGST breakup needs a tax-rate
              snapshot this package's schema access doesn't allow adding
              (see admin-orders.ts's comment) — the totals above are the
              real, exact amounts charged; this states plainly that they
              already include GST rather than implying a tax-exclusive
              price with no tax line shown. */}
          <p className="pt-1 text-right text-xs text-muted">Prices are inclusive of GST.</p>
        </div>

        {(order.trackingNumber || order.courier) && (
          <p className="mt-8 text-xs text-muted">
            Shipped via {order.courier ?? "—"}, tracking number {order.trackingNumber ?? "—"}.
          </p>
        )}

        {invoiceDoc.voided && (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-center text-xs font-semibold text-red-700">
            {invoiceDoc.notice}
          </p>
        )}

        {!invoiceDoc.voided && (
          <div className="mt-10 flex justify-end">
            <div className="text-center text-xs text-muted">
              <p className="mb-8">For {brand.legalName}</p>
              <p className="border-t border-border pt-1">Authorised Signatory</p>
            </div>
          </div>
        )}

        <p className="mt-8 border-t border-border pt-4 text-center text-xs text-muted">
          Thank you for your order — {brand.name}.
        </p>
      </div>
    </div>
  );
}
