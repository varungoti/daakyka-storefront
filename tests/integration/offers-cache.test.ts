import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createOffer, deleteOffer, getActiveOffers, updateOffer } from "@/lib/offers";
import { createDiscount } from "@/lib/discounts";
import { getSetting } from "@/lib/settings";
import { formatBasePrice } from "@/lib/currency/convert";
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

/**
 * F-004: the homepage strip must never advertise a discount code checkout
 * won't redeem (HERO10 was exactly this — a card with no backing Discount
 * row, so every shopper who tried it got "Invalid discount code").
 */
describe("offers strip hides a discount-code offer until the code is real (F-004)", () => {
  let adminId: string;
  const offerIds: string[] = [];
  const discountCodes: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (offerIds.length) {
      await db.offerRecommendation.deleteMany({ where: { id: { in: offerIds } } }).catch(() => {});
    }
    if (discountCodes.length) {
      await db.discount.deleteMany({ where: { code: { in: discountCodes } } }).catch(() => {});
    }
  });

  it("never returns a first_purchase offer whose code has no matching Discount row", async () => {
    const marker = `NOPE${randomUUID().slice(0, 6).toUpperCase()}`;
    const offer = await createOffer(
      {
        name: `Integration Test First Purchase ${marker}`,
        type: "first_purchase",
        description: "10% off first order.",
        active: true,
        config: { code: marker },
      },
      adminId,
    );
    offerIds.push(offer.id);

    const active = await getActiveOffers();
    assert.ok(
      !active.some((o) => o.id === offer.id),
      "an offer naming a code with no real Discount row should never appear",
    );
  });

  it("returns a first_purchase offer once its code is a real, active Discount", async () => {
    const marker = `YES${randomUUID().slice(0, 6).toUpperCase()}`;
    const discount = await createDiscount({ code: marker, type: "PERCENTAGE", value: 10 }, adminId);
    discountCodes.push(discount.code);

    const offer = await createOffer(
      {
        name: `Integration Test First Purchase ${marker}`,
        type: "first_purchase",
        description: "10% off first order.",
        active: true,
        config: { code: marker },
      },
      adminId,
    );
    offerIds.push(offer.id);

    const active = await getActiveOffers();
    assert.ok(
      active.some((o) => o.id === offer.id),
      "an offer naming a code with a real, active Discount row should appear",
    );
  });

  it("hides a first_purchase offer again once its Discount is deactivated", async () => {
    const marker = `OFF${randomUUID().slice(0, 6).toUpperCase()}`;
    const discount = await createDiscount({ code: marker, type: "PERCENTAGE", value: 10, active: false }, adminId);
    discountCodes.push(discount.code);

    const offer = await createOffer(
      {
        name: `Integration Test First Purchase ${marker}`,
        type: "first_purchase",
        description: "10% off first order.",
        active: true,
        config: { code: marker },
      },
      adminId,
    );
    offerIds.push(offer.id);

    const active = await getActiveOffers();
    assert.ok(
      !active.some((o) => o.id === offer.id),
      "an offer naming a code whose Discount is inactive should not appear",
    );
  });

  it("renders a free_shipping offer's description from the live shipping.freeAbove setting, not its stored text", async () => {
    const marker = `Integration Test Free Shipping ${randomUUID().slice(0, 8)}`;
    const offer = await createOffer(
      {
        name: marker,
        type: "free_shipping",
        description: "Free shipping on retail orders over ₹1 (deliberately stale/wrong stored text).",
        active: true,
        config: {},
      },
      adminId,
    );
    offerIds.push(offer.id);

    const freeAbove = await getSetting("shipping.freeAbove");
    const expected = `Free shipping on retail orders over ${formatBasePrice(freeAbove, "INR")}.`;

    const active = await getActiveOffers();
    const found = active.find((o) => o.id === offer.id);
    assert.ok(found, "the free_shipping offer should still appear");
    assert.equal(
      found?.description,
      expected,
      "free_shipping description should always come from the live setting, never the stored row text",
    );
  });
});
