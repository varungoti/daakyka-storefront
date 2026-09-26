import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
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

  // F-196: an unknown id (a stale page, or a lead deleted through some
  // other path) must 404, not fall through to an unhandled Prisma
  // P2025 and a bare 500 — the audit log below must also only be written
  // once the update actually happened.
  let lead;
  try {
    lead = await db.bulkOrderLead.update({
      where: { id },
      data: { status: parsed.data.status },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    throw err;
  }

  await logAuditEvent({
    userId: session.id,
    action: "update_status",
    entity: "bulk_order_lead",
    entityId: id,
    metadata: { status: parsed.data.status },
  });

  return NextResponse.json(lead);
}
