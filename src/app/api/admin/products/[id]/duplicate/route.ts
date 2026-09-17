import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { duplicateProduct, ProductNotFoundError, serializeProductForResponse } from "@/lib/catalog/products";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const { id } = await params;
  try {
    const product = await duplicateProduct(id, session.id);
    return NextResponse.json({ product: serializeProductForResponse(product) }, { status: 201 });
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    throw err;
  }
}
