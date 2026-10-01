import { notFound, redirect } from "next/navigation";
import { DiscountForm } from "@/components/admin/discount-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { DiscountNotFoundForAdminError, getDiscountForAdmin } from "@/lib/discounts";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Edit Discount" };

/** yyyy-mm-dd for an HTML `<input type="date">`.
 *
 * F-038 fix: this used to be `date.toISOString().slice(0, 10)` — plain
 * UTC. discountSchema now stores a date-only "Valid from"/"Valid until" at
 * IST day boundaries (00:00+05:30 / 23:59:59.999+05:30 — see schemas.ts),
 * and 00:00 IST is the PREVIOUS day in UTC (18:30Z). Formatting in UTC
 * therefore displayed a start date one day earlier than what was saved,
 * and re-saving that (now-wrong) value drifted it back another day on
 * every edit. "Valid until"'s 23:59:59.999+05:30 happened to still fall on
 * the same UTC calendar day, which is exactly why only "Valid from" was
 * reported drifting — both need the same fix, since both are IST
 * boundaries now. */
function toDateInputValue(date: Date | null): string | null {
  if (!date) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date);
}

export default async function EditDiscountPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "offers:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const discount = await getDiscountForAdmin(id).catch((err) => {
    if (err instanceof DiscountNotFoundForAdminError) return null;
    throw err;
  });

  if (!discount) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Discount Code</h1>
        <p className="text-muted font-mono">{discount.code}</p>
      </div>
      <DiscountForm
        initial={{
          id: discount.id,
          code: discount.code,
          type: discount.type,
          value: Number(discount.value),
          minSubtotal: discount.minSubtotal != null ? Number(discount.minSubtotal) : null,
          maxRedemptions: discount.maxRedemptions,
          maxRedemptionsPerCustomer: discount.maxRedemptionsPerCustomer,
          startsAt: toDateInputValue(discount.startsAt),
          endsAt: toDateInputValue(discount.endsAt),
          active: discount.active,
          redeemedCount: discount.redeemedCount,
        }}
      />
    </div>
  );
}
