import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildProductInsights, INSIGHT_LABELS, summarizeInsights } from "@/lib/intelligence/product-insights";
import { getProductSource, getProducts } from "@/lib/products";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Intelligence" };

export default async function AdminIntelligencePage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "intelligence:view")) {
    redirect("/admin/dashboard");
  }

  const products = await getProducts();
  const insights = buildProductInsights(products);
  const summary = summarizeInsights(insights);
  const source = getProductSource();

  const viewCounts = await db.productViewEvent.groupBy({
    by: ["productHandle"],
    _count: { productHandle: true },
    orderBy: { _count: { productHandle: "desc" } },
    take: 8,
  });

  // F-112 fix: a productHandle with no matching catalog product is never a
  // real view (the beacon only fires from an actual PDP) — it's either
  // stale data from before the write-side validation existed, or spam from
  // a direct POST. Drop it instead of rendering it verbatim, so this list
  // can never be used to inject arbitrary text into the admin UI.
  const topViewed = viewCounts
    .map((row) => {
      const product = products.find((p) => p.handle === row.productHandle);
      return product ? { handle: row.productHandle, name: product.name, views: row._count.productHandle } : null;
    })
    .filter((row): row is { handle: string; name: string; views: number } => row !== null);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Product Intelligence</h1>
        <p className="text-muted">
          Suggestions based on your {source === "db" ? "product catalogue" : "sample catalogue"}.
        </p>
      </div>

      {/* F-218: be upfront that nothing in the table below comes from sales data. */}
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        These are rule-of-thumb suggestions from each product&apos;s rating, badge and review count. They are not
        based on sales, so treat them as ideas rather than results. &ldquo;Most viewed&rdquo; further down is real
        product-page traffic.
      </p>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total Insights" value={String(summary.total)} />
        <StatCard label="Featured / Top Rated" value={String(summary.topRated)} />
        <StatCard label="Needs Reviews" value={String(summary.seoGaps)} />
        <StatCard label="New Arrivals" value={String(summary.promotions)} />
      </div>

      <section className="overflow-x-auto rounded-3xl border border-border bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Metric</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Recommendation</th>
            </tr>
          </thead>
          <tbody>
            {insights.slice(0, 24).map((insight) => (
              <tr key={`${insight.handle}-${insight.category}`} className="border-b border-border/70">
                <td className="px-4 py-3">
                  <Link
                    href={`/products/${insight.handle}`}
                    className="font-semibold text-brand hover:underline"
                  >
                    {insight.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-lavender/50 px-2 py-1 text-xs font-medium">
                    {INSIGHT_LABELS[insight.category]}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{insight.metric}</td>
                <td className="px-4 py-3 font-semibold text-ink">{Math.round(insight.score)}</td>
                <td className="max-w-xs px-4 py-3 text-muted">{insight.recommendation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {topViewed.length > 0 && (
        <section className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="font-display text-xl font-bold text-ink">Most Viewed Products</h2>
          <ul className="mt-4 space-y-3">
            {topViewed.map((item) => (
              <li key={item.handle} className="flex items-center justify-between rounded-xl border border-border px-4 py-3 text-sm">
                <Link href={`/products/${item.handle}`} className="font-semibold text-brand hover:underline">
                  {item.name}
                </Link>
                <span className="text-muted">{item.views} views</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
