import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ProductsTable } from "@/components/admin/products-table";
import { listCategoryOptions } from "@/lib/catalog/categories";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function AdminProductsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "products:view")) {
    redirect("/admin/dashboard");
  }

  const canManage = hasPermission(session.role, "products:manage");
  const canPublish = hasPermission(session.role, "products:publish");
  const categoryOptions = await listCategoryOptions();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Products</h1>
          <p className="text-muted">Search, filter, and manage the catalog.</p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Link href="/admin/products/import" className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40">
              Import / Export
            </Link>
            <Link href="/admin/products/new" className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand/90">
              New Product
            </Link>
          </div>
        ) : null}
      </div>

      <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
        <ProductsTable categoryOptions={categoryOptions} canManage={canManage} canPublish={canPublish} />
      </Suspense>
    </div>
  );
}
