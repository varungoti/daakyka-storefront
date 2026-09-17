import { requireAdminPermission } from "@/lib/auth/admin-api";
import { exportProductsCsv } from "@/lib/catalog/product-import";

export async function GET(request: Request) {
  const { error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const url = new URL(request.url);
  const categorySlug = url.searchParams.get("categorySlug") ?? undefined;
  const statusParam = url.searchParams.get("status");
  const status = statusParam === "DRAFT" || statusParam === "ACTIVE" || statusParam === "ARCHIVED" ? statusParam : undefined;

  const csv = await exportProductsCsv({ categorySlug, status });
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="products-export.csv"',
    },
  });
}
