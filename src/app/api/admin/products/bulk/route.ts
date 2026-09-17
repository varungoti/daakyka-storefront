import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { hasPermission } from "@/lib/auth/rbac";
import { bulkActionSchema, performBulkAction, ProductCategoryNotFoundError } from "@/lib/catalog/products";

/** Bulk actions need `products:manage`; the `publish` action additionally
 * needs `products:publish`, matching the single-product publish gate. */
export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = bulkActionSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  if (parsed.data.action === "publish" && !hasPermission(session.role, "products:publish")) {
    return NextResponse.json({ error: "Forbidden — publishing requires products:publish" }, { status: 403 });
  }

  try {
    const result = await performBulkAction(parsed.data, session.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProductCategoryNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
