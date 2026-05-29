import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

const schema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAdminPermission("journeys:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const journey = await db.customerJourney.update({
    where: { id },
    data: { status: parsed.data.status },
  });

  await logAuditEvent({
    userId: session!.id,
    action: "update_status",
    entity: "customer_journey",
    entityId: id,
    metadata: { status: parsed.data.status },
  });

  return NextResponse.json(journey);
}
