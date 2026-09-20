import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createOffer, deleteOffer, getActiveOffers, updateOffer } from "@/lib/offers";
import { findAnyAdminId } from "../helpers/admin-user";

/**
 * Covers the P0 fix: an admin's offer create/update/delete reaching the
 * live homepage. src/components/home/offers-strip.tsx calls
 * getActiveOffers() from src/app/page.tsx ("/"), which is fully static.
 * See src/lib/offers/index.ts and src/lib/offers/index.test.ts for the
 * revalidateOffersCache() injection-contract unit coverage (next/cache's
 * real exports can't be spied on). This test covers the other half: the
 * DB write is visible through the exact getter offers-strip.tsx calls —
 * see tests/integration/homepage-cache.test.ts for why this exercises
 * getActiveOffers()'s uncached fallback path rather than a real cache hit
 * outside a Next.js server.
 */
describe("offers cache round trip", () => {
  let adminId: string;
  const createdIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdIds.length) {
      await db.offerRecommendation.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
    }
  });

  it("createOffer's write is visible through getActiveOffers()", async () => {
    const marker = `Integration Test Offer ${randomUUID().slice(0, 8)}`;
    const offer = await createOffer(
      { name: marker, type: "bundle", description: "Cache round-trip coverage.", active: true },
      adminId,
    );
    createdIds.push(offer.id);

    const active = await getActiveOffers();
    assert.ok(
      active.some((o) => o.id === offer.id),
      "newly created active offer should appear in getActiveOffers()",
    );
  });

  it("updateOffer's write (toggling active off) is visible through getActiveOffers()", async () => {
    const marker = `Integration Test Offer ${randomUUID().slice(0, 8)}`;
    const offer = await createOffer(
      { name: marker, type: "bundle", description: "Cache round-trip coverage.", active: true },
      adminId,
    );
    createdIds.push(offer.id);
    assert.ok((await getActiveOffers()).some((o) => o.id === offer.id));

    await updateOffer(offer.id, { active: false }, adminId);

    const active = await getActiveOffers();
    assert.ok(
      !active.some((o) => o.id === offer.id),
      "deactivated offer should no longer appear in getActiveOffers()",
    );
  });

  it("deleteOffer's write is visible through getActiveOffers()", async () => {
    const marker = `Integration Test Offer ${randomUUID().slice(0, 8)}`;
    const offer = await createOffer(
      { name: marker, type: "bundle", description: "Cache round-trip coverage.", active: true },
      adminId,
    );
    createdIds.push(offer.id);
    assert.ok((await getActiveOffers()).some((o) => o.id === offer.id));

    await deleteOffer(offer.id, adminId);
    createdIds.splice(createdIds.indexOf(offer.id), 1);

    const active = await getActiveOffers();
    assert.ok(
      !active.some((o) => o.id === offer.id),
      "deleted offer should no longer appear in getActiveOffers()",
    );
  });
});
