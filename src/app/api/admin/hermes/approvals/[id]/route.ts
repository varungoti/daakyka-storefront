import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { executeHermesApproval } from "@/lib/hermes/approval-executor";
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

  const approval = await db.hermesApproval.update({
    where: { id },
    data: {
      status: parsed.data.status,
      reviewedBy: session!.id,
      reviewedAt: new Date(),
    },
  });

  await logAuditEvent({
    userId: session!.id,
    action: parsed.data.status.toLowerCase(),
    entity: "hermes_approval",
    entityId: id,
  });

  let execution = null;
  if (parsed.data.status === "APPROVED") {
    execution = await executeHermesApproval(id);
  }

  return NextResponse.json({ ...approval, execution });
}
