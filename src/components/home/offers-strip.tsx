import { getActiveOffers } from "@/lib/offers";
import { Tag } from "lucide-react";
import Link from "next/link";

export async function OffersStrip() {
  const offers = await getActiveOffers();
  if (offers.length === 0) return null;

  return (
    <section className="border-y border-border bg-gradient-to-r from-brand/5 via-lavender/40 to-brand/5 py-8">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="mb-4 flex items-center gap-2">
          <Tag size={18} className="text-brand" />
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Current Offers</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {offers.map((offer) => (
            <article
              key={offer.id}
              className="rounded-2xl border border-border bg-white/90 p-4 shadow-sm backdrop-blur-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{offer.type.replace(/_/g, " ")}</p>
              <h3 className="mt-1 font-display font-bold text-ink">{offer.name}</h3>
              <p className="mt-1 text-sm text-muted">{offer.description}</p>
              {offer.type === "first_purchase" && (
                <Link href="/shop" className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                  Shop now →
                </Link>
              )}
              {offer.type === "bulk" && (
                <Link href="/bulk-orders" className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                  Get a quote →
                </Link>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
