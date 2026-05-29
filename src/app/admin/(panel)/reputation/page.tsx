import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getReputationSummary } from "@/lib/reputation/summary";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminReputationPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "intelligence:view")) {
    redirect("/admin/dashboard");
  }

  const summary = await getReputationSummary();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Review & Reputation</h1>
        <p className="text-muted">
          Testimonials, product ratings, and review gaps — pair with post-purchase journeys for
          review requests.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Active Testimonials" value={String(summary.activeTestimonials)} />
        <StatCard label="Featured Quotes" value={String(summary.featuredTestimonials)} />
        <StatCard
          label="Avg Product Rating"
          value={summary.avgProductRating.toFixed(1)}
        />
        <StatCard label="Total Product Reviews" value={String(summary.totalProductReviews)} />
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-3xl border border-border bg-white p-6">
          <h2 className="font-display text-xl font-bold text-ink">Top Rated Products</h2>
          <ul className="mt-4 space-y-3">
            {summary.topRated.map((product) => (
              <li key={product.id} className="flex items-center justify-between gap-4 text-sm">
                <Link href={`/products/${product.handle}`} className="font-medium text-brand hover:underline">
                  {product.name}
                </Link>
                <span className="text-muted">
                  {product.rating}★ · {product.reviewCount} reviews
                </span>
              </li>
            ))}
            {summary.topRated.length === 0 && (
              <p className="text-sm text-muted">No high-review products in current catalog.</p>
            )}
          </ul>
        </article>

        <article className="rounded-3xl border border-border bg-white p-6">
          <h2 className="font-display text-xl font-bold text-ink">Review Gaps</h2>
          <p className="mt-1 text-sm text-muted">
            Products flagged for low review volume — candidates for post-purchase review requests.
          </p>
          <ul className="mt-4 space-y-3">
            {summary.lowReviewProducts.map((item) => (
              <li key={item.handle} className="rounded-2xl border border-border/70 p-3 text-sm">
                <p className="font-semibold text-ink">{item.name}</p>
                <p className="mt-1 text-muted">{item.metric}</p>
                <p className="mt-1 text-xs text-brand">{item.recommendation}</p>
              </li>
            ))}
            {summary.lowReviewProducts.length === 0 && (
              <p className="text-sm text-muted">No review gaps detected.</p>
            )}
          </ul>
        </article>
      </section>

      <section className="rounded-3xl border border-border bg-lavender/20 p-6">
        <h2 className="font-display text-lg font-bold text-ink">Recommended Actions</h2>
        <ul className="mt-4 space-y-2 text-sm text-muted">
          <li>
            • Manage homepage quotes in{" "}
            <Link href="/admin/testimonials" className="font-semibold text-brand hover:underline">
              Testimonials
            </Link>
          </li>
          <li>
            • Ensure post-purchase journey is active in{" "}
            <Link href="/admin/journeys" className="font-semibold text-brand hover:underline">
              Customer Journeys
            </Link>
          </li>
          <li>
            • Review product intelligence in{" "}
            <Link href="/admin/intelligence" className="font-semibold text-brand hover:underline">
              Intelligence
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-brand">{value}</p>
    </div>
  );
}
