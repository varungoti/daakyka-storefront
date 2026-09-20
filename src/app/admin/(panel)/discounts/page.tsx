import Link from "next/link";
import { redirect } from "next/navigation";
import { DiscountToggle } from "@/components/admin/discount-toggle";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { listDiscountsForAdmin } from "@/lib/discounts";

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatValue(type: "PERCENTAGE" | "FIXED", value: number): string {
  return type === "PERCENTAGE" ? `${value}% off` : `${formatInr(value)} off`;
}

/** Release-hardening F7: admin discount-code list — create/edit/deactivate
 * codes and see redemption counts. Gated on `offers:manage` (see
 * src/app/api/admin/discounts/route.ts for why that permission was
 * reused). */
export default async function AdminDiscountsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "offers:manage")) {
    redirect("/admin/dashboard");
  }

  const discounts = await listDiscountsForAdmin();
  const activeCount = discounts.filter((d) => d.active).length;
  const totalRedemptions = discounts.reduce((sum, d) => sum + d.redeemedCount, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Discount Codes</h1>
          <p className="text-muted">Create and manage coupon codes redeemable at checkout.</p>
        </div>
        <Link
          href="/admin/discounts/new"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          New Discount Code
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total Codes" value={String(discounts.length)} />
        <StatCard label="Active" value={String(activeCount)} />
        <StatCard label="Total Redemptions" value={String(totalRedemptions)} />
      </div>

      <section className="overflow-x-auto rounded-3xl border border-border bg-surface">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Value</th>
              <th className="px-4 py-3">Min. order</th>
              <th className="px-4 py-3">Redeemed</th>
              <th className="px-4 py-3">Window</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {discounts.map((discount) => (
              <tr key={discount.id}>
                <td className="px-4 py-3 font-mono font-semibold text-ink">{discount.code}</td>
                <td className="px-4 py-3 text-ink">{formatValue(discount.type, Number(discount.value))}</td>
                <td className="px-4 py-3 text-muted">
                  {discount.minSubtotal != null ? formatInr(Number(discount.minSubtotal)) : "—"}
                </td>
                <td className="px-4 py-3 text-muted">
                  {discount.redeemedCount}
                  {discount.maxRedemptions != null ? ` / ${discount.maxRedemptions}` : ""}
                  {discount.maxRedemptionsPerCustomer != null ? ` (max ${discount.maxRedemptionsPerCustomer}/customer)` : ""}
                </td>
                <td className="px-4 py-3 text-muted">
                  {discount.startsAt ? new Date(discount.startsAt).toLocaleDateString("en-IN") : "Any time"}
                  {discount.endsAt ? ` – ${new Date(discount.endsAt).toLocaleDateString("en-IN")}` : ""}
                </td>
                <td className="px-4 py-3">
                  <DiscountToggle id={discount.id} active={discount.active} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/discounts/${discount.id}`}
                    className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {discounts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No discount codes yet. Create one to make a promotion redeemable at checkout.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-brand">{value}</p>
    </div>
  );
}
