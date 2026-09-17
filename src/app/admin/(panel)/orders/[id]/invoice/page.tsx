import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getOrderForAdmin, OrderNotFoundError } from "@/lib/orders/admin-orders";
import { getSetting } from "@/lib/settings";
import { brand } from "@/data/brand";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import { InvoicePrintButton } from "@/components/admin/invoice-print-button";

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
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
  const [phone, email, addressLine] = await Promise.all([
    getSetting("contact.phone"),
    getSetting("contact.email"),
    getSetting("contact.address"),
  ]);

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
          </div>
          <div className="text-right">
            <h2 className="font-display text-xl font-bold">Invoice</h2>
            <p className="text-sm text-muted">Order {order.number}</p>
            <p className="text-sm text-muted">{order.createdAt.toLocaleDateString("en-IN")}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted">{order.status.replace("_", " ")}</p>
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
                <td className="py-2 text-right">{item.quantity}</td>
                <td className="py-2 text-right">{formatInr(item.unitPrice)}</td>
                <td className="py-2 text-right">{formatInr(item.unitPrice * item.quantity)}</td>
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
        </div>

        {(order.trackingNumber || order.courier) && (
          <p className="mt-8 text-xs text-muted">
            Shipped via {order.courier ?? "—"}, tracking number {order.trackingNumber ?? "—"}.
          </p>
        )}

        <p className="mt-8 border-t border-border pt-4 text-center text-xs text-muted">
          Thank you for your order — {brand.name}.
        </p>
      </div>
    </div>
  );
}
