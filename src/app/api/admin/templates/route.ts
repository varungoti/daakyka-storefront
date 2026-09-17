import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { createTemplate, listTemplatesForAdmin } from "@/lib/engagement/templates";
import { templateSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("engagement:manage");
  if (error) return error;
  const templates = await listTemplatesForAdmin();
  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = templateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  const template = await createTemplate(parsed.data, session!.id);
  return NextResponse.json(template, { status: 201 });
}
