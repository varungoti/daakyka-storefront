import Link from "next/link";
import { redirect } from "next/navigation";
import { listSizeChartsForAdmin } from "@/lib/catalog/size-charts";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function AdminSizeChartsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "categories:manage")) {
    redirect("/admin/dashboard");
  }

  const sizeCharts = await listSizeChartsForAdmin();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Size Charts</h1>
          <p className="text-muted">Manage the tables shown in the storefront size guide.</p>
        </div>
        <Link
          href="/admin/size-charts/new"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          New Size Chart
        </Link>
      </div>

      {sizeCharts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
          No size charts yet.
        </p>
      ) : (
        <div className="space-y-3">
          {sizeCharts.map((chart) => (
            <Link
              key={chart.id}
              href={`/admin/size-charts/${chart.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 transition hover:border-brand/40"
            >
              <div>
                <p className="font-semibold text-ink">{chart.name}</p>
                <p className="text-xs text-muted">
                  {chart.columns.length} column{chart.columns.length === 1 ? "" : "s"} ·{" "}
                  {chart.rows.length} row{chart.rows.length === 1 ? "" : "s"} · Unit:{" "}
                  {chart.unit === "IN" ? "Inches" : "Centimeters"}
                </p>
              </div>
              <span className="text-xs text-muted">
                {chart.categoryCount} categor{chart.categoryCount === 1 ? "y" : "ies"} · {chart.productCount} product
                {chart.productCount === 1 ? "" : "s"}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
