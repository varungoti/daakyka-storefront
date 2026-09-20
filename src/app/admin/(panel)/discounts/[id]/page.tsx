import { notFound, redirect } from "next/navigation";
import { DiscountForm } from "@/components/admin/discount-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { DiscountNotFoundForAdminError, getDiscountForAdmin } from "@/lib/discounts";

/** yyyy-mm-dd for an HTML `<input type="date">` — UTC, matching how the
 * form sends it back (see discount-form.tsx / discountSchema's
 * z.coerce.date()). */
function toDateInputValue(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
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
