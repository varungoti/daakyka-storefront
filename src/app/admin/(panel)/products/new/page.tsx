import { redirect } from "next/navigation";
import { ProductForm } from "@/components/admin/product-form";
import { listCategoryOptions } from "@/lib/catalog/categories";
import { listSizeChartsForAdmin } from "@/lib/catalog/size-charts";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewProductPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "products:manage")) {
    redirect("/admin/dashboard");
  }

  const [categoryOptions, sizeCharts] = await Promise.all([listCategoryOptions(), listSizeChartsForAdmin()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Product</h1>
        <p className="text-muted">Save a draft, add variants and images, then publish when ready.</p>
      </div>
      <ProductForm
        categoryOptions={categoryOptions}
        sizeChartOptions={sizeCharts.map((c) => ({ id: c.id, name: c.name }))}
        canPublish={hasPermission(session.role, "products:publish")}
      />
    </div>
  );
}
