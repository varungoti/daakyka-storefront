import { requireAdminPermission } from "@/lib/auth/admin-api";
import { exportProductsCsv } from "@/lib/catalog/product-import";
import { logAuditEvent } from "@/lib/auth/audit";

export async function GET(request: Request) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const url = new URL(request.url);
  const categorySlug = url.searchParams.get("categorySlug") ?? undefined;
  const statusParam = url.searchParams.get("status");
  const status = statusParam === "DRAFT" || statusParam === "ACTIVE" || statusParam === "ARCHIVED" ? statusParam : undefined;

  const csv = await exportProductsCsv({ categorySlug, status });

  // F-290 fix: a bulk data export used to leave no audit trail at all —
  // see the matching fix in ../orders/export/route.ts.
  await logAuditEvent({
    userId: session.id,
    action: "export",
    entity: "product",
    metadata: { filters: { categorySlug, status } },
  });
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="products-export.csv"',
    },
  });
}
