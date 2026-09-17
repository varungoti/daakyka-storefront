import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  categoryUpdateSchema,
  CategoryCycleError,
  CategoryDeleteBlockedError,
  CategoryNotFoundError,
  CategoryParentNotFoundError,
  CategorySectionMismatchError,
  CategorySlugConflictError,
  deleteCategory,
  getCategoryForAdmin,
  SizeChartRefNotFoundError,
  updateCategory,
} from "@/lib/catalog/categories";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const { id } = await params;
  try {
    const category = await getCategoryForAdmin(id);
    return NextResponse.json({ category });
  } catch (err) {
    if (err instanceof CategoryNotFoundError) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = categoryUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const category = await updateCategory(id, parsed.data, session.id);
    return NextResponse.json({ category });
  } catch (err) {
    if (err instanceof CategoryNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    if (err instanceof CategorySlugConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (
      err instanceof CategoryParentNotFoundError ||
      err instanceof CategorySectionMismatchError ||
      err instanceof CategoryCycleError ||
      err instanceof SizeChartRefNotFoundError
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const { id } = await params;
  try {
    await deleteCategory(id, session.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof CategoryNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    if (err instanceof CategoryDeleteBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
