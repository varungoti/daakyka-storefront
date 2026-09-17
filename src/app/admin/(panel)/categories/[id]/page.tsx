import { notFound, redirect } from "next/navigation";
import { CategoryForm } from "@/components/admin/category-form";
import { CategoryNotFoundError, getCategoryForAdmin, listCategoryOptions } from "@/lib/catalog/categories";
import { listSizeChartsForAdmin } from "@/lib/catalog/size-charts";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "categories:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const [category, categoryOptions, sizeCharts] = await Promise.all([
    getCategoryForAdmin(id).catch((err) => {
      if (err instanceof CategoryNotFoundError) return null;
      throw err;
    }),
    listCategoryOptions(),
    listSizeChartsForAdmin(),
  ]);

  if (!category) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Category</h1>
        <p className="text-muted">{category.name}</p>
      </div>
      <CategoryForm
        initial={{
          id: category.id,
          name: category.name,
          slug: category.slug,
          description: category.description,
          section: category.section,
          parentId: category.parentId,
          sizeChartId: category.sizeChartId,
          seoTitle: category.seoTitle,
          seoDescription: category.seoDescription,
          active: category.active,
          showInMenu: category.showInMenu,
          image: category.image,
        }}
        categoryOptions={categoryOptions}
        sizeChartOptions={sizeCharts.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
