import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { dispatchCampaign } from "@/lib/engagement/campaign-dispatcher";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { campaignUpdateSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// F-217: a campaign's content (name/channel/segment/template/notes) can
// only be edited before it's committed to actually going out — once it's
// APPROVED, SCHEDULED, SENDING, or SENT, changing the segment or template
// out from under it would be surprising (or, mid-send, unsafe). CANCELLED
// stays editable so a cancelled draft can be fixed up and resubmitted.
const EDITABLE_CAMPAIGN_STATUSES = ["DRAFT", "PENDING_APPROVAL", "CANCELLED"] as const;

function isDetailEdit(data: {
  name?: string;
  channel?: string;
  segmentId?: string | null;
  templateId?: string | null;
  notes?: string | null;
}): boolean {
  return (
    data.name !== undefined ||
    data.channel !== undefined ||
    data.segmentId !== undefined ||
    data.templateId !== undefined ||
    data.notes !== undefined
  );
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;
  const campaign = await db.campaign.findUnique({
    where: { id },
    include: { segment: true, template: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  return NextResponse.json(campaign);
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = campaignUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  const existing = await db.campaign.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // F-217: name/channel/segment/template/notes edits, as opposed to a pure
  // status transition — see EDITABLE_CAMPAIGN_STATUSES above for why this
  // is gated on the campaign's *current* status, not the status (if any)
  // this same request is also trying to move it to.
  if (isDetailEdit(parsed.data) && !(EDITABLE_CAMPAIGN_STATUSES as readonly string[]).includes(existing.status)) {
    return NextResponse.json(
      { error: `Campaign details can only be edited while it's Draft, Pending Approval, or Cancelled (currently ${existing.status}).` },
      { status: 400 },
    );
  }

  if (existing.status === "SENT" && parsed.data.status === "SENT") {
    return NextResponse.json({ error: "Campaign already sent" }, { status: 409 });
  }

  if (parsed.data.status === "SCHEDULED") {
    // F-217: the admin UI used to let a campaign move to SCHEDULED with no
    // date collected anywhere, storing scheduledAt=NULL — and
    // processDueScheduledCampaigns only ever selects rows where
    // `scheduledAt <= now`, so a NULL one silently never sends. Require a
    // real, future send time up front instead of discovering the trap
    // later. `parsed.data.scheduledAt` can be `null` (explicitly clearing
    // it) as well as `undefined` (not sent this call) — either falls back
    // to whatever the campaign already had.
    const scheduledAtValue = parsed.data.scheduledAt ?? existing.scheduledAt?.toISOString() ?? null;
    if (!scheduledAtValue) {
      return NextResponse.json(
        { error: "Pick a send time before scheduling this campaign." },
        { status: 400 },
      );
    }
    if (new Date(scheduledAtValue).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Scheduled time must be in the future." }, { status: 400 });
    }

    const templateId = parsed.data.templateId !== undefined ? parsed.data.templateId : existing.templateId;
    const segmentId = parsed.data.segmentId !== undefined ? parsed.data.segmentId : existing.segmentId;
    if (!templateId) {
      return NextResponse.json(
        { error: "Attach a message template before scheduling this campaign." },
        { status: 400 },
      );
    }
    if (!segmentId) {
      return NextResponse.json(
        { error: "Attach an audience segment before scheduling this campaign." },
        { status: 400 },
      );
    }
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
      const campaign = await db.campaign.findUnique({
        where: { id },
        include: { segment: true, template: true },
      });
      // F-212: the client needs the dispatch counts (delivered/failed/
      // skipped/stub) to show the admin what actually happened — it used
      // to get only the campaign row back and had no way to report a
      // result.
      return NextResponse.json({ ...campaign, dispatch: dispatchResult });
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
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.channel !== undefined ? { channel: parsed.data.channel } : {}),
      ...(parsed.data.segmentId !== undefined ? { segmentId: parsed.data.segmentId } : {}),
      ...(parsed.data.templateId !== undefined ? { templateId: parsed.data.templateId } : {}),
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
      ...(parsed.data.scheduledAt !== undefined
        ? { scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null }
        : {}),
    },
  });

  await logAuditEvent({
    userId: session!.id,
    action: parsed.data.status !== undefined ? "update_status" : "update",
    entity: "campaign",
    entityId: id,
    metadata: parsed.data.status !== undefined ? { status: parsed.data.status } : { name: campaign.name },
  });

  return NextResponse.json(campaign);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;
  const existing = await db.campaign.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // F-217: a campaign that's currently sending, or already sent, is a
  // record of what actually went out — deleting it would erase that
  // history (and, mid-send, race the dispatcher). Everything else (DRAFT,
  // PENDING_APPROVAL, APPROVED, SCHEDULED, CANCELLED, FAILED) is safe to
  // remove outright; CampaignDelivery cascades on delete.
  if (existing.status === "SENDING" || existing.status === "SENT") {
    return NextResponse.json(
      { error: `A ${existing.status.toLowerCase()} campaign can't be deleted — cancel future sends instead.` },
      { status: 409 },
    );
  }

  await db.campaign.delete({ where: { id } });

  await logAuditEvent({
    userId: session!.id,
    action: "delete",
    entity: "campaign",
    entityId: id,
    metadata: { name: existing.name },
  });

  return NextResponse.json({ success: true });
}
