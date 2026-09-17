import { requireAdminPermission } from "@/lib/auth/admin-api";
import { buildImportTemplateCsv } from "@/lib/catalog/product-import";

export async function GET() {
  const { error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const csv = buildImportTemplateCsv();
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="product-import-template.csv"',
    },
  });
}
