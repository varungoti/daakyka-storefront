import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { archiveProduct, ProductNotFoundError, publishProduct, serializeProductForResponse, unpublishProduct } from "@/lib/catalog/products";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Publish/unpublish/archive a single product. `publish` and `unpublish`
 * require `products:publish` (the whole point of CATALOG_MANAGER being
 * able to edit but not ship a product); `archive` only requires
 * `products:manage`, since taking a live product down is closer to
 * ordinary catalog upkeep than a launch decision. */
export async function POST(request: Request, { params }: RouteParams) {
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const body = bodyResult.data as { action?: unknown };
  const action = body?.action === "unpublish" ? "unpublish" : body?.action === "archive" ? "archive" : "publish";

  const permission = action === "archive" ? "products:manage" : "products:publish";
  const { session, error } = await requireAdminPermission(permission);
  if (error) return error;

  const { id } = await params;
  try {
    const product =
      action === "publish" ? await publishProduct(id, session.id) : action === "unpublish" ? await unpublishProduct(id, session.id) : await archiveProduct(id, session.id);
    return NextResponse.json({ product: serializeProductForResponse(product) });
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    throw err;
  }
}
