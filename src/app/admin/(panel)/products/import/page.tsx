import { redirect } from "next/navigation";
import { ProductImportForm } from "@/components/admin/product-import-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function ProductImportPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "products:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Import / Export Products</h1>
        <p className="text-muted">One row per variant, grouped by product slug. Dry run first, then commit.</p>
      </div>
      <ProductImportForm />
    </div>
  );
}
