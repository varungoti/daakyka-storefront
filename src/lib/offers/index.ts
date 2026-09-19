import { revalidateTag, unstable_cache } from "next/cache";
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

async function readActiveOffersFromDb(): Promise<StoreOffer[]> {
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

// Cached with Next's data cache, tagged "offers" so the admin CRUD below
// can invalidate it via revalidateTag — same pattern as
// src/lib/settings/index.ts's getSetting().
export const OFFERS_CACHE_TAG = "offers";

const cachedGetActiveOffers = unstable_cache(
  readActiveOffersFromDb,
  ["active-offers"],
  { tags: [OFFERS_CACHE_TAG] },
);

export async function getActiveOffers(): Promise<StoreOffer[]> {
  try {
    return await cachedGetActiveOffers();
  } catch {
    // unstable_cache needs Next's incremental cache / request store, which
    // isn't present outside an actual Next server (unit tests, scripts,
    // etc). Fall back to an uncached read rather than throwing.
    return readActiveOffersFromDb();
  }
}

/**
 * Invalidates the cached getActiveOffers() read. Split out (rather than
 * inlining revalidateTag in each CRUD function below) so it's
 * independently testable — see src/lib/homepage/index.ts's
 * revalidateHomepageCache() for why: next/cache's exports can't be
 * mocked from a test (non-configurable accessor properties, and this
 * project's tests run as real ESM anyway), so tests inject a fake
 * `revalidate` here instead of spying on the real one.
 */
export function revalidateOffersCache(
  revalidate: (tag: string, profile: string) => void = revalidateTag,
): void {
  try {
    revalidate(OFFERS_CACHE_TAG, "max");
  } catch {
    // No static generation store in this context (unit/integration tests,
    // one-off scripts) — nothing to revalidate.
  }
}

// ---------------------------------------------------------------------------
// Admin CRUD (audit gap: "Offers can't be toggled or edited. No API.")
//
// getActiveOffers() above (consumed by src/components/home/offers-strip.tsx
// on the static "/" home page) is cached via unstable_cache and tagged
// OFFERS_CACHE_TAG. Next bakes that read into the prerendered HTML at
// build time regardless of caching, so every write below calls
// revalidateOffersCache() — without it, an edit would never reach the
// live site short of a full redeploy. See src/lib/homepage/index.ts's
// HOMEPAGE_CACHE_TAG comment for the doc citation on why revalidateTag
// alone (no revalidatePath) is sufficient here.
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

  revalidateOffersCache();
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

  revalidateOffersCache();
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

  revalidateOffersCache();
}
