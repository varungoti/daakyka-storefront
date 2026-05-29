import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { buildProductInsights, summarizeInsights } from "@/lib/intelligence/product-insights";
import { getProductSource, getProducts } from "@/lib/products";
import Link from "next/link";
import { redirect } from "next/navigation";

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

  const topViewed = viewCounts.map((row) => {
    const product = products.find((p) => p.handle === row.productHandle);
    return {
      handle: row.productHandle,
      name: product?.name ?? row.productHandle,
      views: row._count.productHandle,
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Product Intelligence</h1>
        <p className="text-muted">
          Catalog insights from {source === "shopify" ? "live Shopify" : "seed catalog"} — expand
          with analytics when connected.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Total Insights" value={String(summary.total)} />
        <StatCard label="Best Sellers" value={String(summary.bestSellers)} />
        <StatCard label="Bundle Candidates" value={String(summary.bundles)} />
        <StatCard label="SEO Opportunities" value={String(summary.seoGaps)} />
      </div>

      <section className="overflow-x-auto rounded-3xl border border-border bg-white">
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
                    {insight.category.replace(/_/g, " ")}
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
        <section className="rounded-3xl border border-border bg-white p-6">
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
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-brand">{value}</p>
    </div>
  );
}
