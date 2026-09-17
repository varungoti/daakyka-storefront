import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import type { CustomerSegment } from "@/generated/prisma/client";
import type { z } from "zod";
import type { segmentSchema, segmentUpdateSchema } from "@/lib/validation/schemas";

/**
 * Admin CRUD for `CustomerSegment`, mirroring the service-layer pattern in
 * src/lib/catalog/categories.ts: validation/errors live here, route
 * handlers in src/app/api/admin/segments/**\/route.ts just translate
 * exceptions to HTTP status codes.
 *
 * `criteria` is stored as a JSON string (see prisma/schema.prisma) and
 * read by src/lib/engagement/segment-resolver.ts as a loosely-typed
 * `{ source?, consent?, leadType?, pages? }` bag — the admin UI edits it
 * as a small JSON object rather than hard-coding those fields, since
 * segment-resolver.ts may grow more shapes over time.
 */

export type SegmentInput = z.infer<typeof segmentSchema>;
export type SegmentUpdateInput = z.infer<typeof segmentUpdateSchema>;

export class SegmentNotFoundError extends Error {
  constructor(id: string) {
    super(`Segment ${id} not found`);
    this.name = "SegmentNotFoundError";
  }
}

export class SegmentSlugConflictError extends Error {
  constructor(slug: string) {
    super(`Slug "${slug}" is already in use by another segment`);
    this.name = "SegmentSlugConflictError";
  }
}

export class SegmentDeleteBlockedError extends Error {
  constructor(public readonly campaignCount: number) {
    super(
      `${campaignCount} active campaign${campaignCount === 1 ? "" : "s"} still reference this segment — cancel or reassign them first`,
    );
    this.name = "SegmentDeleteBlockedError";
  }
}

/** Campaign statuses that count as "still active" for the delete-blocked
 * check — a fully SENT or CANCELLED campaign is historical and shouldn't
 * block cleaning up a segment. */
const ACTIVE_CAMPAIGN_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED"] as const;

async function assertSlugAvailable(slug: string, excludeId?: string): Promise<void> {
  const existing = await db.customerSegment.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== excludeId) {
    throw new SegmentSlugConflictError(slug);
  }
}

export async function listSegmentsForAdmin(): Promise<CustomerSegment[]> {
  return db.customerSegment.findMany({ orderBy: { name: "asc" } });
}

export async function getSegmentForAdmin(id: string): Promise<CustomerSegment> {
  const segment = await db.customerSegment.findUnique({ where: { id } });
  if (!segment) throw new SegmentNotFoundError(id);
  return segment;
}

export async function createSegment(input: SegmentInput, userId: string): Promise<CustomerSegment> {
  await assertSlugAvailable(input.slug);

  const segment = await db.customerSegment.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description ?? null,
      criteria: JSON.stringify(input.criteria ?? {}),
    },
  });

  await logAuditEvent({
    userId,
    action: "create",
    entity: "customer_segment",
    entityId: segment.id,
  });

  return segment;
}

export async function updateSegment(
  id: string,
  input: SegmentUpdateInput,
  userId: string,
): Promise<CustomerSegment> {
  const existing = await db.customerSegment.findUnique({ where: { id } });
  if (!existing) throw new SegmentNotFoundError(id);

  if (input.slug !== undefined && input.slug !== existing.slug) {
    await assertSlugAvailable(input.slug, id);
  }

  const updated = await db.customerSegment.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.criteria !== undefined ? { criteria: JSON.stringify(input.criteria) } : {}),
    },
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "customer_segment",
    entityId: id,
    metadata: { name: updated.name },
  });

  return updated;
}

export async function deleteSegment(id: string, userId: string): Promise<void> {
  const existing = await db.customerSegment.findUnique({ where: { id } });
  if (!existing) throw new SegmentNotFoundError(id);

  const activeCampaigns = await db.campaign.count({
    where: { segmentId: id, status: { in: [...ACTIVE_CAMPAIGN_STATUSES] } },
  });
  if (activeCampaigns > 0) {
    throw new SegmentDeleteBlockedError(activeCampaigns);
  }

  await db.customerSegment.delete({ where: { id } });

  await logAuditEvent({
    userId,
    action: "delete",
    entity: "customer_segment",
    entityId: id,
    metadata: { name: existing.name, slug: existing.slug },
  });
}
