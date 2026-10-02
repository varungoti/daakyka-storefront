import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { reviewHermesApproval } from "@/lib/hermes/approval-executor";
import { canApproveHermesApproval, requiredPermissionForApproval } from "@/lib/hermes/approval-permissions";
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

  // F-293: approving creates a real Campaign / blog post, so the approver
  // needs that entity's own permission, not just hermes:manage (see
  // approval-permissions.ts). A missing approval falls through to the 404
  // from reviewHermesApproval below.
  if (parsed.data.status === "APPROVED") {
    const existing = await db.hermesApproval.findUnique({ where: { id }, select: { type: true } });
    if (existing && !canApproveHermesApproval(session!.role, existing.type)) {
      const required = requiredPermissionForApproval(existing.type);
      return NextResponse.json(
        {
          error:
            required === "engagement:manage"
              ? "Approving campaign drafts requires campaign permissions"
              : "You don't have permission to approve this type of item",
        },
        { status: 403 },
      );
    }
  }

  const result = await reviewHermesApproval(id, parsed.data.status, session!.id);
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A duplicate PATCH on an already-reviewed approval is a legitimate
  // double-click, not a new decision — don't log a second audit event for it.
  if (result.transitioned) {
    // F-293: record what got approved/rejected and, for an approval, what
    // it actually created — previously this row carried no metadata at
    // all, so there was no audit trail linking the Hermes approval to the
    // campaign/blog post it produced beyond the (unindexed)
    // HermesApproval.executionResult column.
    await logAuditEvent({
      userId: session!.id,
      action: parsed.data.status.toLowerCase(),
      entity: "hermes_approval",
      entityId: id,
      metadata: { type: result.approval.type, execution: result.execution },
    });
  }

  return NextResponse.json({ ...result.approval, execution: result.execution });
}
