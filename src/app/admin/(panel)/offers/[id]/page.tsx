import { notFound, redirect } from "next/navigation";
import { OfferForm } from "@/components/admin/offer-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getOfferForAdmin, OfferNotFoundError } from "@/lib/offers";

export default async function EditOfferPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "offers:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const offer = await getOfferForAdmin(id).catch((err) => {
    if (err instanceof OfferNotFoundError) return null;
    throw err;
  });

  if (!offer) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Offer</h1>
        <p className="text-muted">{offer.name}</p>
      </div>
      <OfferForm initial={offer} />
    </div>
  );
}
