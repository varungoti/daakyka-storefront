import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { createSeoRecord, listSeoRecordsForAdmin, SeoPagePathConflictError } from "@/lib/seo/records";
import { seoPageRecordSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("seo:manage");
  if (error) return error;
  const records = await listSeoRecordsForAdmin();
  return NextResponse.json(records);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("seo:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = seoPageRecordSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const record = await createSeoRecord(parsed.data, session!.id);
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    if (err instanceof SeoPagePathConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
