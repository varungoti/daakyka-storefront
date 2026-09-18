import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { reviewHermesApproval } from "@/lib/hermes/approval-executor";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

const schema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAdminPermission("hermes:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const result = await reviewHermesApproval(id, parsed.data.status, session!.id);
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A duplicate PATCH on an already-reviewed approval is a legitimate
  // double-click, not a new decision — don't log a second audit event for it.
  if (result.transitioned) {
    await logAuditEvent({
      userId: session!.id,
      action: parsed.data.status.toLowerCase(),
      entity: "hermes_approval",
      entityId: id,
    });
  }

  return NextResponse.json({ ...result.approval, execution: result.execution });
}
