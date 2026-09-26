import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  archiveProduct,
  ProductNotArchivedError,
  ProductNotFoundError,
  ProductNotPublishableError,
  publishProduct,
  serializeProductForResponse,
  unarchiveProduct,
  unpublishProduct,
} from "@/lib/catalog/products";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Publish/unpublish/archive/unarchive a single product. `publish` and
 * `unpublish` require `products:publish` (the whole point of
 * CATALOG_MANAGER being able to edit but not ship a product); `archive`
 * and `unarchive` (F-185) only require `products:manage`, since taking a
 * live product down — or bringing a never-published one back to DRAFT — is
 * closer to ordinary catalog upkeep than a launch decision. `unarchive` is
 * deliberately its own action rather than reusing `unpublish` (both land on
 * DRAFT): CATALOG_MANAGER can archive a product but must not need
 * `products:publish` just to undo that. */
export async function POST(request: Request, { params }: RouteParams) {
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const body = bodyResult.data as { action?: unknown };
  const action =
    body?.action === "unpublish"
      ? "unpublish"
      : body?.action === "archive"
        ? "archive"
        : body?.action === "unarchive"
          ? "unarchive"
          : "publish";

  const permission = action === "archive" || action === "unarchive" ? "products:manage" : "products:publish";
  const { session, error } = await requireAdminPermission(permission);
  if (error) return error;

  const { id } = await params;
  try {
    const product =
      action === "publish"
        ? await publishProduct(id, session.id)
        : action === "unpublish"
          ? await unpublishProduct(id, session.id)
          : action === "archive"
            ? await archiveProduct(id, session.id)
            : await unarchiveProduct(id, session.id);
    return NextResponse.json({ product: serializeProductForResponse(product) });
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (err instanceof ProductNotPublishableError || err instanceof ProductNotArchivedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
