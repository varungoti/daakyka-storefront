import { DeleteButton } from "@/components/admin/delete-button";
import { OfferToggle } from "@/components/admin/offer-toggle";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { listOffersForAdmin } from "@/lib/offers";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminOffersPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "offers:manage")) {
    redirect("/admin/dashboard");
  }

  const offers = await listOffersForAdmin();

  const activeCount = offers.filter((o) => o.active).length;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Smart Offer Engine</h1>
          <p className="text-muted">
            Bundle, shipping, first-purchase, and institutional offers — approval required before
            storefront activation.
          </p>
        </div>
        <Link
          href="/admin/offers/new"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          New Offer
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total Offers" value={String(offers.length)} />
        <StatCard label="Active" value={String(activeCount)} />
        <StatCard label="Draft / Paused" value={String(offers.length - activeCount)} />
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        {offers.map((offer) => {
          const config = JSON.parse(offer.config) as Record<string, unknown>;
          return (
            <article key={offer.id} className="rounded-3xl border border-border bg-surface p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand">{offer.type}</p>
                  <h2 className="mt-1 font-display text-lg font-bold text-ink">{offer.name}</h2>
                </div>
                <OfferToggle id={offer.id} active={offer.active} />
              </div>
              <p className="mt-3 text-sm text-muted">{offer.description}</p>
              {Object.keys(config).length > 0 && (
                <dl className="mt-4 space-y-1 text-xs text-muted">
                  {Object.entries(config).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="font-semibold text-ink">{key}:</dt>
                      <dd>{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="mt-4 flex gap-2">
                <Link
                  href={`/admin/offers/${offer.id}`}
                  className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40"
                >
                  Edit
                </Link>
                <DeleteButton
                  href={`/api/admin/offers/${offer.id}`}
                  confirmMessage={`Delete the "${offer.name}" offer?`}
                />
              </div>
            </article>
          );
        })}
        {offers.length === 0 && (
          <p className="col-span-full rounded-3xl border border-dashed border-border p-8 text-center text-muted">
            No offers configured. Run database seed to load defaults.
          </p>
        )}
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
