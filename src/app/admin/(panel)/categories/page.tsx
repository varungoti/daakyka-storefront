import Link from "next/link";
import { redirect } from "next/navigation";
import { CategoryTree } from "@/components/admin/category-tree";
import { categorySectionValues, listCategoriesForAdmin, SECTION_LABELS } from "@/lib/catalog/categories";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function AdminCategoriesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "categories:manage")) {
    redirect("/admin/dashboard");
  }

  const tree = await listCategoriesForAdmin();
  const bySection = new Map(categorySectionValues.map((section) => [section, tree.filter((c) => c.section === section)]));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Categories</h1>
          <p className="text-muted">
            Organize the catalog into sections and sub-categories. Menu visibility and order here
            drive the storefront navigation.
          </p>
        </div>
        <Link
          href="/admin/categories/new"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          New Category
        </Link>
      </div>

      <div className="space-y-8">
        {categorySectionValues.map((section) => {
          const roots = bySection.get(section) ?? [];
          return (
            <section key={section} className="space-y-3">
              <h2 className="font-display text-lg font-bold text-ink">{SECTION_LABELS[section]}</h2>
              {roots.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border bg-surface p-4 text-sm text-muted">
                  No categories in this section yet.
                </p>
              ) : (
                <CategoryTree nodes={roots} />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
