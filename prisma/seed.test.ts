import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";

/**
 * F-070: what `npx tsx prisma/seed.ts` leaves in the database. Seeded
 * customer journeys used to start ACTIVE — which sends automatically the
 * moment Brevo/WATI is enabled, with no approval step — reuse the same
 * template on every step (the same email going out 3-4 times), and
 * advertise a HERO10 discount code that was never a real Discount row (it
 * failed at checkout).
 *
 * Run this against a freshly seeded database only — e.g. via testdb.mjs,
 * whose `setup <name>` step runs `db:setup` (migrate + seed). Never
 * against the default DATABASE_URL (see AGENTS.md / the task's SAFETY
 * note): `node testdb.mjs run seed_data_integrity_and_credentials --
 * npx tsx --env-file-if-exists=.env --test prisma/seed.test.ts`.
 */
describe("prisma/seed.ts journey defaults", () => {
  it("seeds welcome-series, abandoned-cart, and post-purchase as not-ACTIVE", async () => {
    const journeys = await db.customerJourney.findMany({
      where: { slug: { in: ["welcome-series", "abandoned-cart", "post-purchase"] } },
    });
    assert.equal(journeys.length, 3, "expected all three seeded marketing journeys to exist");
    for (const journey of journeys) {
      assert.notEqual(
        journey.status,
        "ACTIVE",
        `${journey.slug} should not start ACTIVE — an ACTIVE journey sends automatically once its channel is enabled, with no approval step`,
      );
    }
  });

  it("keeps bulk-order-followup ACTIVE", async () => {
    // Unlike the marketing journeys above, this one only creates an
    // internal AdminNotification and WhatsApp acknowledgements for a new
    // institutional lead — not consumer marketing email — and the owner
    // needs new leads to actually notify them from day one.
    const journey = await db.customerJourney.findUnique({ where: { slug: "bulk-order-followup" } });
    assert.ok(journey, "expected the bulk-order-followup journey to exist");
    assert.equal(journey?.status, "ACTIVE");
  });

  it("never mentions the non-existent HERO10 discount code in any seeded message template", async () => {
    const templates = await db.messageTemplate.findMany();
    assert.ok(templates.length > 0, "expected seeded message templates to exist");
    for (const template of templates) {
      assert.doesNotMatch(
        template.body,
        /HERO10/i,
        `template "${template.name}" body should not mention HERO10`,
      );
      if (template.subject) {
        assert.doesNotMatch(
          template.subject,
          /HERO10/i,
          `template "${template.name}" subject should not mention HERO10`,
        );
      }
    }
  });

  it("never seeds a HERO10 offer recommendation or discount code", async () => {
    const offer = await db.offerRecommendation.findFirst({
      where: {
        OR: [{ name: { contains: "HERO10" } }, { config: { contains: "HERO10" } }],
      },
    });
    assert.equal(offer, null, "no seeded offer should reference HERO10");

    const discount = await db.discount.findFirst({ where: { code: "HERO10" } });
    assert.equal(discount, null, "HERO10 should not exist as a real, redeemable discount code");
  });

  it("each of welcome-series, abandoned-cart, and post-purchase seeds exactly one step", async () => {
    // Before this fix, each of these journeys had 3-4 steps that all
    // pointed at the same MessageTemplate, so the same email went out
    // several times over the following days/weeks.
    const journeys = await db.customerJourney.findMany({
      where: { slug: { in: ["welcome-series", "abandoned-cart", "post-purchase"] } },
      include: { steps: true },
    });
    for (const journey of journeys) {
      assert.equal(
        journey.steps.length,
        1,
        `${journey.slug} should have exactly one seeded step, not a sequence that resends the same template`,
      );
    }
  });

  it("bulk-order-followup's WhatsApp steps use distinct templates", async () => {
    const journey = await db.customerJourney.findUnique({
      where: { slug: "bulk-order-followup" },
      include: { steps: { where: { channel: "WHATSAPP" } } },
    });
    assert.ok(journey);
    const templateIds = journey!.steps.map((s) => s.templateId).filter((id): id is string => Boolean(id));
    assert.equal(
      new Set(templateIds).size,
      templateIds.length,
      "the acknowledgement and quote-follow-up WhatsApp steps should not reuse the same template",
    );
  });
});
