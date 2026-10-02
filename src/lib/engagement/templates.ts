import { logAuditEvent } from "@/lib/auth/audit";
import { diffFields } from "@/lib/auth/audit-diff";
import { db } from "@/lib/db";
import type { MessageTemplate } from "@/generated/prisma/client";
import type { z } from "zod";
import type { templateSchema, templateUpdateSchema } from "@/lib/validation/schemas";

/** Admin CRUD for `MessageTemplate` — see src/lib/engagement/segments.ts's
 * header comment for the shared conventions this mirrors. */

export type TemplateInput = z.infer<typeof templateSchema>;
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;

export class TemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Template ${id} not found`);
    this.name = "TemplateNotFoundError";
  }
}

export class TemplateDeleteBlockedError extends Error {
  constructor(public readonly campaignCount: number) {
    super(
      `${campaignCount} campaign${campaignCount === 1 ? "" : "s"} still approved, scheduled, or sending reference this template — cancel or reassign them first`,
    );
    this.name = "TemplateDeleteBlockedError";
  }
}

/** F-217: campaign statuses that count as "in flight" for the delete-blocked
 * check — mirrors segments.ts's ACTIVE_CAMPAIGN_STATUSES, but a template is
 * safe to detach even from a campaign that hasn't sent yet (DRAFT/
 * PENDING_APPROVAL/CANCELLED/FAILED): those still need an admin to pick a
 * template before they can move forward, but nothing is mid-flight for
 * them. A SENT campaign is historical, same reasoning as segments.ts's own
 * comment. Only a campaign that's about to send, or sending right now,
 * should block deleting the template out from under it — this is also what
 * unblocks deleting an old seeded template that a DRAFT/PENDING_APPROVAL
 * seed campaign still references. Campaign.templateId is `onDelete:
 * SetNull` (prisma/schema.prisma), so every non-blocking reference is
 * safely nulled by the delete itself, not left dangling. */
const BLOCKING_CAMPAIGN_STATUSES = ["APPROVED", "SCHEDULED", "SENDING"] as const;

export async function listTemplatesForAdmin(): Promise<MessageTemplate[]> {
  return db.messageTemplate.findMany({ orderBy: { updatedAt: "desc" } });
}

export async function getTemplateForAdmin(id: string): Promise<MessageTemplate> {
  const template = await db.messageTemplate.findUnique({ where: { id } });
  if (!template) throw new TemplateNotFoundError(id);
  return template;
}

export async function createTemplate(input: TemplateInput, userId: string): Promise<MessageTemplate> {
  const template = await db.messageTemplate.create({
    data: {
      name: input.name,
      channel: input.channel,
      subject: input.subject ?? null,
      body: input.body,
      variables: input.variables ? JSON.stringify(input.variables) : null,
    },
  });

  await logAuditEvent({
    userId,
    action: "create",
    entity: "message_template",
    entityId: template.id,
    metadata: { name: template.name, channel: template.channel },
  });

  return template;
}

export async function updateTemplate(
  id: string,
  input: TemplateUpdateInput,
  userId: string,
): Promise<MessageTemplate> {
  const existing = await db.messageTemplate.findUnique({ where: { id } });
  if (!existing) throw new TemplateNotFoundError(id);

  const updated = await db.messageTemplate.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.channel !== undefined ? { channel: input.channel } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.variables !== undefined
        ? { variables: input.variables ? JSON.stringify(input.variables) : null }
        : {}),
    },
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "message_template",
    entityId: id,
    // F-288: what moved, not just the new name. The body is long, so only the
    // fact that it changed is recorded.
    metadata: {
      name: updated.name,
      changes: diffFields(existing, updated, ["name", "channel", "subject"]),
      ...(existing.body !== updated.body ? { bodyChanged: true } : {}),
    },
  });

  return updated;
}

export async function deleteTemplate(id: string, userId: string): Promise<void> {
  const existing = await db.messageTemplate.findUnique({ where: { id } });
  if (!existing) throw new TemplateNotFoundError(id);

  const campaignCount = await db.campaign.count({
    where: { templateId: id, status: { in: [...BLOCKING_CAMPAIGN_STATUSES] } },
  });
  if (campaignCount > 0) {
    throw new TemplateDeleteBlockedError(campaignCount);
  }

  await db.messageTemplate.delete({ where: { id } });

  await logAuditEvent({
    userId,
    action: "delete",
    entity: "message_template",
    entityId: id,
    metadata: { name: existing.name },
  });
}
