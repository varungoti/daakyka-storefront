import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { logAuditEvent } from "@/lib/auth/audit";
import { diffFields } from "@/lib/auth/audit-diff";
import { ADMIN_REVALIDATE_PROFILE } from "@/lib/cache/admin-revalidate";
import type { RevalidateProfile } from "@/lib/cache/admin-revalidate";
import { isDiscountCodeActive } from "@/lib/discounts";
import { getSetting } from "@/lib/settings";
import { formatBasePrice } from "@/lib/currency/convert";
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

const MAX_ACTIVE_OFFERS = 4;

/**
 * Release-hardening F-004: the homepage strip must never advertise an
 * offer checkout doesn't honour, and must never fall back to hardcoded
 * copy. Two type-specific corrections on top of the raw `active` rows:
 *
 *  - Any offer naming a discount code (`config.code`, e.g. type
 *    "first_purchase") is only kept when that code is a real, currently
 *    redeemable Discount row (see src/lib/discounts's isDiscountCodeActive)
 *    — HERO10 was a card with no backing Discount at all, so every
 *    shopper who tried it got "Invalid discount code" at checkout.
 *  - A "free_shipping" card's description is always rendered from the
 *    live `shipping.freeAbove` setting rather than whatever static text is
 *    stored on the row, so it can't silently drift from what checkout
 *    actually charges (the stored copy once said ₹8,299 while checkout
 *    charged from a setting of ₹8,000).
 *
 * Fetches more than MAX_ACTIVE_OFFERS up front since the discount-code
 * check above can drop rows — otherwise an inactive/expired code's card
 * would leave fewer than MAX_ACTIVE_OFFERS shown even when enough other
 * valid offers exist.
 */
async function readActiveOffersFromDb(): Promise<StoreOffer[]> {
  try {
    const rows = await db.offerRecommendation.findMany({
      where: { active: true },
      orderBy: { createdAt: "desc" },
      take: MAX_ACTIVE_OFFERS * 5,
    });

    const freeAbove = await getSetting("shipping.freeAbove");
    const offers: StoreOffer[] = [];

    for (const row of rows) {
      const config = JSON.parse(row.config) as Record<string, unknown>;

      if (typeof config.code === "string" && config.code.trim()) {
        if (!(await isDiscountCodeActive(config.code))) continue;
      }

      offers.push({
        id: row.id,
        name: row.name,
        type: row.type,
        description:
          row.type === "free_shipping"
            ? `Free shipping on retail orders over ${formatBasePrice(freeAbove, "INR")}.`
            : row.description,
        config,
      });

      if (offers.length === MAX_ACTIVE_OFFERS) break;
    }

    return offers;
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
  revalidate: (tag: string, profile: RevalidateProfile) => void = revalidateTag,
): void {
  try {
    // F-214: immediate ({ expire: 0 }), not "max" — see
    // src/lib/cache/admin-revalidate.ts.
    revalidate(OFFERS_CACHE_TAG, ADMIN_REVALIDATE_PROFILE);
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
    metadata: { name: offer.name, type: offer.type, active: offer.active },
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
    // F-288: the before -> after of what moved (an offer switched on or off
    // is the change that matters most here).
    metadata: {
      name: updated.name,
      active: updated.active,
      changes: diffFields(existing, updated, ["name", "type", "description", "active"]),
      ...(existing.config !== updated.config ? { configChanged: true } : {}),
    },
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
