import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  deleteProduct,
  getProductForAdmin,
  InvalidCompareAtPriceError,
  ProductCategoryNotFoundError,
  ProductDeleteBlockedError,
  ProductNotDraftError,
  ProductNotFoundError,
  ProductSizeChartNotFoundError,
  ProductSlugConflictError,
  productUpdateSchema,
  serializeProductForResponse,
  updateProduct,
} from "@/lib/catalog/products";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("products:view");
  if (error) return error;

  const { id } = await params;
  try {
    const product = await getProductForAdmin(id);
    return NextResponse.json({ product });
  } catch (err) {
    if (err instanceof ProductNotFoundError) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = productUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const product = await updateProduct(id, parsed.data, session.id);
    return NextResponse.json({ product: serializeProductForResponse(product) });
  } catch (err) {
    if (err instanceof ProductNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (err instanceof ProductSlugConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (
      err instanceof ProductCategoryNotFoundError ||
      err instanceof ProductSizeChartNotFoundError ||
      err instanceof InvalidCompareAtPriceError
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const { id } = await params;
  try {
    await deleteProduct(id, session.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ProductNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    if (err instanceof ProductNotDraftError || err instanceof ProductDeleteBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
