import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { db } from "@/lib/db";

/**
 * F-070: what `npx tsx prisma/seed.ts` leaves in the database. Seeded
 * customer journeys used to start ACTIVE — which sends automatically the
 * moment Brevo/WATI is enabled, with no approval step — reuse the same
 * template on every step (the same email going out 3-4 times), and
 * advertise a HERO10 discount code that was never a real Discount row (it
 * failed at checkout).
 *
 * Also covers F-223 (content seeding must run at most once per database —
 * an admin's deletion of a seeded record must survive the next deploy) and
 * F-232 (the legacy admin@daakyka.com/viewer@daakyka.com deactivation must
 * never fire against whichever address is the configured ADMIN_SEED_EMAIL/
 * VIEWER_SEED_EMAIL). Those two re-run `prisma/seed.ts` as a child process
 * via runSeed() below, against whatever DATABASE_URL this process already
 * has — safe only because that's the isolated test database testdb.mjs
 * pointed it at.
 *
 * Run this against a freshly seeded database only — e.g. via testdb.mjs,
 * whose `setup <name>` step runs `db:setup` (migrate + seed). Never
 * against the default DATABASE_URL (see AGENTS.md / the task's SAFETY
 * note): `node testdb.mjs run seed_data_integrity_and_credentials --
 * npx tsx --env-file-if-exists=.env --test prisma/seed.test.ts`.
 */

/**
 * Re-runs `prisma/seed.ts` as a child process, inheriting this process's
 * env (in particular `DATABASE_URL`, already pointed at the isolated test
 * database by testdb.mjs) with the given overrides layered on top.
 */
function runSeed(extraEnv: Record<string, string> = {}): void {
  const result = spawnSync("npx", ["tsx", "prisma/seed.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
    shell: true,
  });
  assert.equal(result.status, 0, `prisma/seed.ts exited with status ${result.status}`);
}
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

/**
 * F-223: the seed used to re-run its content section (blog posts,
 * testimonials, offers, SEO records, ...) on every deploy, keyed only on
 * existence — so deleting a seeded record from /admin didn't survive the
 * next deploy. ensureContentSeeded() now gates that behind a one-time
 * marker. This repo no longer seeds testimonials at all (F-005), so a
 * seeded blog post stands in for "content the owner deliberately removed".
 */
describe("prisma/seed.ts content seeding runs at most once (F-223)", () => {
  it("does not recreate a seeded blog post that was deleted, on a later re-seed", async () => {
    const slug = "how-to-choose-medical-scrubs";

    const before = await db.blogPostRecord.findUnique({ where: { slug } });
    assert.ok(before, "expected the initial seed (testdb.mjs setup) to have created this blog post");

    // Re-run the seed once more while the post still exists — simulates a
    // second deploy against an already-content-seeded database. Content
    // seeding must be a no-op here.
    runSeed();
    const stillThere = await db.blogPostRecord.findUnique({ where: { slug } });
    assert.ok(stillThere, "a second, no-op seed run should not have touched the post");

    await db.blogPostRecord.delete({ where: { slug } });

    // A third run — simulating the deploy right after the admin's deletion
    // — must not resurrect it.
    runSeed();
    const after = await db.blogPostRecord.findUnique({ where: { slug } });
    assert.equal(after, null, "seed re-ran content seeding and recreated a deleted blog post");
  });
});

/**
 * F-232: the legacy admin@daakyka.com/viewer@daakyka.com deactivation used
 * to run unconditionally on every deploy, keyed only on the email — so
 * setting ADMIN_SEED_EMAIL=admin@daakyka.com created that very account and
 * then immediately deactivated it in the same run.
 */
describe("prisma/seed.ts legacy account handling (F-232)", () => {
  it("keeps admin@daakyka.com active across repeated seed runs when it is the configured ADMIN_SEED_EMAIL", async () => {
    const email = "admin@daakyka.com";

    runSeed({ ADMIN_SEED_EMAIL: email });
    let user = await db.user.findUnique({ where: { email } });
    assert.ok(user, "expected the seed to create admin@daakyka.com as the configured ADMIN_SEED_EMAIL");
    assert.equal(user?.active, true, "a freshly seeded ADMIN_SEED_EMAIL account should be active");

    // A later deploy with the same ADMIN_SEED_EMAIL must not deactivate it
    // as if it were the stale legacy default account.
    runSeed({ ADMIN_SEED_EMAIL: email });
    user = await db.user.findUnique({ where: { email } });
    assert.equal(
      user?.active,
      true,
      "admin@daakyka.com should stay active on re-seed — it is the configured ADMIN_SEED_EMAIL, not a stale legacy account",
    );
  });
});
