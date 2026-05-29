import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

const updateSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "QUOTED", "WON", "LOST"]),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("bulk-orders:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = updateSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const lead = await db.bulkOrderLead.update({
    where: { id },
    data: { status: parsed.data.status },
  });

  await logAuditEvent({
    userId: session.id,
    action: "update_status",
    entity: "bulk_order_lead",
    entityId: id,
    metadata: { status: parsed.data.status },
  });

  return NextResponse.json(lead);
}
