import Link from "next/link";
import { redirect } from "next/navigation";
import { DiscountToggle } from "@/components/admin/discount-toggle";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { listDiscountsForAdmin } from "@/lib/discounts";
import { DISCOUNT_STATE_LABELS, getDiscountListState, type DiscountListState } from "@/lib/discounts/status";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Discount Codes" };

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

function formatValue(type: "PERCENTAGE" | "FIXED", value: number): string {
  return type === "PERCENTAGE" ? `${value}% off` : `${formatInr(value)} off`;
}

type DiscountListRow = Awaited<ReturnType<typeof listDiscountsForAdmin>>[number];

function formatRedeemed(discount: DiscountListRow): string {
  return (
    `${discount.redeemedCount}` +
    (discount.maxRedemptions != null ? ` / ${discount.maxRedemptions}` : "") +
    (discount.maxRedemptionsPerCustomer != null ? ` (max ${discount.maxRedemptionsPerCustomer}/customer)` : "")
  );
}

/* F-038: explicit timeZone — without it this renders in the server's local
   zone (UTC on Vercel), which is a day off from the IST calendar day
   discountSchema now stores startsAt/endsAt boundaries at. */
function formatWindow(discount: DiscountListRow): string {
  const day = (date: Date) => new Date(date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  return (discount.startsAt ? day(discount.startsAt) : "Any time") + (discount.endsAt ? ` – ${day(discount.endsAt)}` : "");
}

/** The switch above can read "Active" for a code that checkout would still
 * refuse (not started, ended, or out of redemptions) — say so next to it. */
function StateBadge({ state }: { state: DiscountListState }) {
  if (state === "ACTIVE" || state === "INACTIVE") return null;
  return (
    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
      {DISCOUNT_STATE_LABELS[state]}
    </span>
  );
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
  const now = new Date();
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

      {/* F-206: table from lg up; stacked cards below it so the on/off
          toggle and Edit button are on screen at phone width. */}
      <section className="hidden overflow-x-auto rounded-3xl border border-border bg-surface lg:block">
        <table className="w-full text-left text-sm">
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
                <td className="px-4 py-3 text-muted">{formatRedeemed(discount)}</td>
                <td className="px-4 py-3 text-muted">{formatWindow(discount)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <DiscountToggle id={discount.id} active={discount.active} />
                    <StateBadge state={getDiscountListState(discount, now)} />
                  </div>
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

      <ul className="space-y-3 lg:hidden" aria-label="Discount codes">
        {discounts.map((discount) => (
          <li key={discount.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all font-mono font-semibold text-ink">{discount.code}</p>
                <p className="text-sm text-ink">{formatValue(discount.type, Number(discount.value))}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <DiscountToggle id={discount.id} active={discount.active} />
                <StateBadge state={getDiscountListState(discount, now)} />
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
              <div>
                <dt className="text-muted">Min. order</dt>
                <dd className="text-ink">{discount.minSubtotal != null ? formatInr(Number(discount.minSubtotal)) : "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Redeemed</dt>
                <dd className="text-ink">{formatRedeemed(discount)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted">Window</dt>
                <dd className="text-ink">{formatWindow(discount)}</dd>
              </div>
            </dl>
            <div className="mt-3 text-right">
              <Link
                href={`/admin/discounts/${discount.id}`}
                className="inline-flex min-h-10 items-center rounded-full border border-border px-4 py-2 text-xs font-semibold text-ink hover:bg-lilac/40"
              >
                Edit
                <span className="sr-only"> {discount.code}</span>
              </Link>
            </div>
          </li>
        ))}
        {discounts.length === 0 && (
          <li className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
            No discount codes yet. Create one to make a promotion redeemable at checkout.
          </li>
        )}
      </ul>
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
