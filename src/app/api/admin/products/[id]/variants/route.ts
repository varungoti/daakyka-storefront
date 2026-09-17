import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { DuplicateVariantKeyError, DuplicateVariantSkuError } from "@/lib/catalog/product-validation";
import { ProductNotFoundError, ProductSlugConflictError, replaceVariants, variantsInputSchema } from "@/lib/catalog/products";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Replaces the full variant list for a product in one call — the admin
 * form always sends the complete grid rather than diffing individual
 * rows, which keeps the (size,color)/SKU uniqueness rules simple to
 * enforce (see assertUniqueVariants). */
export async function POST(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = variantsInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await replaceVariants(id, parsed.data.variants, session.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (err instanceof DuplicateVariantKeyError || err instanceof DuplicateVariantSkuError || err instanceof ProductSlugConflictError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
