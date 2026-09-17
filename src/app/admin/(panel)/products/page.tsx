import { redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

/**
 * Placeholder — the full products admin (list, filters, bulk actions,
 * create/edit with variants and images, CSV import) is Phase B1, a
 * separate task. This page exists so the "Products" nav link resolves
 * and still enforces `products:view`.
 */
export default async function AdminProductsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "products:view")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Products</h1>
        <p className="text-muted">Product management is coming next.</p>
      </div>
      <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted">
        The full product catalog editor (list, variants, AI images, CSV import) ships in the next phase.
        In the meantime, manage categories and size charts from the Catalog menu.
      </div>
    </div>
  );
}
