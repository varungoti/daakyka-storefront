import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { campaignSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const campaigns = await db.campaign.findMany({
    orderBy: { updatedAt: "desc" },
    include: { segment: true, template: true },
  });

  return NextResponse.json(campaigns);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = campaignSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const campaign = await db.campaign.create({
    data: {
      name: parsed.data.name,
      channel: parsed.data.channel,
      status: parsed.data.status,
      segmentId: parsed.data.segmentId ?? null,
      templateId: parsed.data.templateId ?? null,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
      notes: parsed.data.notes,
    },
  });

  await logAuditEvent({
    userId: session!.id,
    action: "create",
    entity: "campaign",
    entityId: campaign.id,
  });

  return NextResponse.json(campaign, { status: 201 });
}
