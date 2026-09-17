import { redirect } from "next/navigation";
import { CategoryForm } from "@/components/admin/category-form";
import { listCategoryOptions } from "@/lib/catalog/categories";
import { listSizeChartsForAdmin } from "@/lib/catalog/size-charts";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewCategoryPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "categories:manage")) {
    redirect("/admin/dashboard");
  }

  const [categoryOptions, sizeCharts] = await Promise.all([listCategoryOptions(), listSizeChartsForAdmin()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Category</h1>
        <p className="text-muted">Add a category or sub-category to the catalog.</p>
      </div>
      <CategoryForm
        categoryOptions={categoryOptions}
        sizeChartOptions={sizeCharts.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
