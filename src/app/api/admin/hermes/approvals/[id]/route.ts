import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { hasPermission } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { reviewHermesApproval } from "@/lib/hermes/approval-executor";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

const schema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

// F-293: PATCH here only ever checked `hermes:manage`, which SEO_MANAGER
// has without `engagement:manage` — but approving a "campaign_draft"
// creates a Campaign row directly (executeHermesApproval), bypassing
// POST /api/admin/campaigns' own `engagement:manage` check entirely. Only
// campaign_draft needs a second permission today: blog_draft only needs
// `blog:manage`, which every role with `hermes:manage` already has.
const APPROVAL_TYPE_PERMISSIONS: Partial<Record<string, "engagement:manage">> = {
  campaign_draft: "engagement:manage",
};

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

  if (parsed.data.status === "APPROVED") {
    const existing = await db.hermesApproval.findUnique({ where: { id }, select: { type: true } });
    const requiredPermission = existing ? APPROVAL_TYPE_PERMISSIONS[existing.type] : undefined;
    if (requiredPermission && !hasPermission(session!.role, requiredPermission)) {
      return NextResponse.json(
        { error: "Approving this item requires campaign permissions" },
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
