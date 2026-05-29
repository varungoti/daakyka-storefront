import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { dispatchCampaign } from "@/lib/engagement/campaign-dispatcher";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

const statusSchema = z.object({
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "SENT", "CANCELLED"]),
  sendNow: z.boolean().optional(),
  scheduledAt: z.string().datetime().optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = statusSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const existing = await db.campaign.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (existing.status === "SENT" && parsed.data.status === "SENT") {
    return NextResponse.json({ error: "Campaign already sent" }, { status: 409 });
  }

  const shouldDispatch =
    parsed.data.status === "SENT" ||
    (parsed.data.status === "APPROVED" && parsed.data.sendNow === true);

  if (shouldDispatch) {
    try {
      const dispatchResult = await dispatchCampaign(id);
      await logAuditEvent({
        userId: session!.id,
        action: "dispatch",
        entity: "campaign",
        entityId: id,
        metadata: { ...dispatchResult },
      });
      return NextResponse.json(
        await db.campaign.findUnique({
          where: { id },
          include: { segment: true, template: true },
        }),
      );
    } catch (dispatchError) {
      return NextResponse.json(
        {
          error:
            dispatchError instanceof Error ? dispatchError.message : "Campaign dispatch failed",
        },
        { status: 400 },
      );
    }
  }

  const campaign = await db.campaign.update({
    where: { id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.scheduledAt ? { scheduledAt: new Date(parsed.data.scheduledAt) } : {}),
    },
  });

  await logAuditEvent({
    userId: session!.id,
    action: "update_status",
    entity: "campaign",
    entityId: id,
    metadata: { status: parsed.data.status },
  });

  return NextResponse.json(campaign);
}
