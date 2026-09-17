import { redirect } from "next/navigation";
import { OfferForm } from "@/components/admin/offer-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewOfferPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "offers:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Offer</h1>
        <p className="text-muted">Add a bundle, shipping, first-purchase, or institutional offer.</p>
      </div>
      <OfferForm />
    </div>
  );
}
