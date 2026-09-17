import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/auth/audit";
import type { OfferRecommendation } from "@/generated/prisma/client";
import type { z } from "zod";
import type { offerSchema, offerUpdateSchema } from "@/lib/validation/schemas";

export interface StoreOffer {
  id: string;
  name: string;
  type: string;
  description: string;
  config: Record<string, unknown>;
}

export async function getActiveOffers(): Promise<StoreOffer[]> {
  try {
    const rows = await db.offerRecommendation.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      take: 4,
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      config: JSON.parse(row.config) as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Admin CRUD (audit gap: "Offers can't be toggled or edited. No API.")
//
// getActiveOffers() above (consumed by src/components/home/offers-strip.tsx
// on the homepage) is a plain, uncached db call — no unstable_cache/tag,
// and the home page doesn't set `revalidate`/`dynamic` either — so writes
// below are visible on the next request without a revalidateTag() call,
// same reasoning as src/lib/testimonials/index.ts.
// ---------------------------------------------------------------------------

export type OfferInput = z.infer<typeof offerSchema>;
export type OfferUpdateInput = z.infer<typeof offerUpdateSchema>;

export class OfferNotFoundError extends Error {
  constructor(id: string) {
    super(`Offer ${id} not found`);
    this.name = "OfferNotFoundError";
  }
}

export async function listOffersForAdmin(): Promise<OfferRecommendation[]> {
  return db.offerRecommendation.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getOfferForAdmin(id: string): Promise<OfferRecommendation> {
  const offer = await db.offerRecommendation.findUnique({ where: { id } });
  if (!offer) throw new OfferNotFoundError(id);
  return offer;
}

export async function createOffer(input: OfferInput, userId: string): Promise<OfferRecommendation> {
  const offer = await db.offerRecommendation.create({
    data: {
      name: input.name,
      type: input.type,
      description: input.description,
      active: input.active ?? true,
      config: JSON.stringify(input.config ?? {}),
    },
  });

  await logAuditEvent({
    userId,
    action: "create",
    entity: "offer_recommendation",
    entityId: offer.id,
  });

  return offer;
}

export async function updateOffer(
  id: string,
  input: OfferUpdateInput,
  userId: string,
): Promise<OfferRecommendation> {
  const existing = await db.offerRecommendation.findUnique({ where: { id } });
  if (!existing) throw new OfferNotFoundError(id);

  const updated = await db.offerRecommendation.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.config !== undefined ? { config: JSON.stringify(input.config) } : {}),
    },
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "offer_recommendation",
    entityId: id,
    metadata: { name: updated.name, active: updated.active },
  });

  return updated;
}

export async function deleteOffer(id: string, userId: string): Promise<void> {
  const existing = await db.offerRecommendation.findUnique({ where: { id } });
  if (!existing) throw new OfferNotFoundError(id);

  await db.offerRecommendation.delete({ where: { id } });

  await logAuditEvent({
    userId,
    action: "delete",
    entity: "offer_recommendation",
    entityId: id,
    metadata: { name: existing.name },
  });
}
