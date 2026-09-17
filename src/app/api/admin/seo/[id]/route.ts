import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  deleteSeoRecord,
  getSeoRecordForAdmin,
  SeoPagePathConflictError,
  SeoPageRecordNotFoundError,
  updateSeoRecord,
} from "@/lib/seo/records";
import { seoPageRecordUpdateSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("seo:manage");
  if (error) return error;

  const { id } = await params;
  try {
    const record = await getSeoRecordForAdmin(id);
    return NextResponse.json(record);
  } catch (err) {
    if (err instanceof SeoPageRecordNotFoundError) {
      return NextResponse.json({ error: "SEO record not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("seo:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = seoPageRecordUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const record = await updateSeoRecord(id, parsed.data, session!.id);
    return NextResponse.json(record);
  } catch (err) {
    if (err instanceof SeoPageRecordNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "SEO record not found" }, { status: 404 });
    }
    if (err instanceof SeoPagePathConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

// PUT is treated as a full-replace alias of PATCH — the task calls for
// "PUT/PATCH", and since the schema already allows a partial update, a
// separate PUT with a stricter (non-partial) schema would just duplicate
// this handler. Kept as a named export so either verb works from the UI.
export { PATCH as PUT };

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("seo:manage");
  if (error) return error;

  const { id } = await params;
  try {
    await deleteSeoRecord(id, session!.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof SeoPageRecordNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "SEO record not found" }, { status: 404 });
    }
    throw err;
  }
}
