import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  categoryInputSchema,
  createCategory,
  CategoryCycleError,
  CategoryParentNotFoundError,
  CategorySectionMismatchError,
  CategorySlugConflictError,
  listCategoriesForAdmin,
  SizeChartRefNotFoundError,
} from "@/lib/catalog/categories";

export async function GET() {
  const { error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const categories = await listCategoriesForAdmin();
  return NextResponse.json({ categories });
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = categoryInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const category = await createCategory(parsed.data, session.id);
    return NextResponse.json({ category }, { status: 201 });
  } catch (err) {
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
