import { redirect } from "next/navigation";
import { DiscountForm } from "@/components/admin/discount-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewDiscountPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "offers:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Discount Code</h1>
        <p className="text-muted">Add a coupon code shoppers can redeem at checkout.</p>
      </div>
      <DiscountForm />
    </div>
  );
}
