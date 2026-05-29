import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { templateSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("engagement:manage");
  if (error) return error;
  const templates = await db.messageTemplate.findMany({ orderBy: { updatedAt: "desc" } });
  return NextResponse.json(templates);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = templateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const template = await db.messageTemplate.create({
    data: {
      ...parsed.data,
      variables: parsed.data.variables ? JSON.stringify(parsed.data.variables) : null,
    },
  });

  await logAuditEvent({
    userId: session!.id,
    action: "create",
    entity: "message_template",
    entityId: template.id,
  });

  return NextResponse.json(template, { status: 201 });
}
