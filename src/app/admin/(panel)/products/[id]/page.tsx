import { notFound, redirect } from "next/navigation";
import { ProductForm } from "@/components/admin/product-form";
import { getProductForAdmin, ProductNotFoundError } from "@/lib/catalog/products";
import { listCategoryOptions } from "@/lib/catalog/categories";
import { listSizeChartsForAdmin } from "@/lib/catalog/size-charts";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "products:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const [product, categoryOptions, sizeCharts] = await Promise.all([
    getProductForAdmin(id).catch((err) => {
      if (err instanceof ProductNotFoundError) return null;
      throw err;
    }),
    listCategoryOptions(),
    listSizeChartsForAdmin(),
  ]);

  if (!product) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Product</h1>
        <p className="text-muted">{product.name}</p>
      </div>
      <ProductForm
        initial={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          shortDescription: product.shortDescription,
          description: product.description,
          categoryId: product.categoryId,
          status: product.status,
          featured: product.featured,
          isNew: product.isNew,
          price: product.price,
          compareAtPrice: product.compareAtPrice,
          gender: product.gender,
          fabric: product.fabric,
          care: product.care,
          tags: product.tags,
          sizeChartId: product.sizeChartId,
          seoTitle: product.seoTitle,
          seoDescription: product.seoDescription,
          variants: product.variants,
          images: product.images.map((img) => ({ id: img.id, mediaId: img.mediaId, url: img.url, alt: img.alt, color: img.color, sortOrder: img.sortOrder })),
          orderCount: product.orderCount,
        }}
        categoryOptions={categoryOptions}
        sizeChartOptions={sizeCharts.map((c) => ({ id: c.id, name: c.name }))}
        canPublish={hasPermission(session.role, "products:publish")}
      />
    </div>
  );
}
