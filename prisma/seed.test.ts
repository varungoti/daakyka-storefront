import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { db } from "@/lib/db";
import { draftCategories, draftSizeCharts } from "@/data/catalog/draft-catalog";
import type { Prisma } from "@/generated/prisma/client";
import {
  CATALOG_CONTENT_CORRECTION_MARKER_KEY,
  JOURNEY_CONTENT_CORRECTION_MARKER_KEY,
  correctSeededCatalogContent,
  correctSeededJourneyContent,
  runSeededContentCorrections,
} from "./seed-corrections";

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

  it("never seeds a 'Top + Bottom Bundle' offer — no bundle pricing logic exists (F-004)", async () => {
    const offer = await db.offerRecommendation.findFirst({ where: { name: "Top + Bottom Bundle" } });
    assert.equal(offer, null, "no fresh database should get a bundle offer with nothing behind it");
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
 * F-004: the homepage offers strip used to advertise a "Top + Bottom
 * Bundle — 10% off" and a "First Purchase — HERO10" code that checkout
 * never honoured. Removing both from seedContent()'s `offers` array (the
 * describe block above) only stops a *fresh* database from getting them —
 * ensureContentSeeded() (F-223) never re-runs seedContent() at all against
 * an already-content-seeded database, which is what production is. These
 * tests cover the separate, always-runs-once fixup in main() that
 * deactivates the two rows a past deploy already created there.
 */
describe("prisma/seed.ts deactivates the unhonoured HERO10 / bundle offers already in production (F-004)", () => {
  it("deactivates an untouched, pre-existing 'Top + Bottom Bundle' row, and never reactivates it again", async () => {
    // Simulate "production before this fix": the exact row the old seed
    // used to create, still active, and the one-time marker not yet set
    // (a database this old predates the marker entirely).
    await db.siteSetting.delete({ where: { key: "seed.unhonouredOffersHandledAt" } }).catch(() => {});
    const stale = await db.offerRecommendation.create({
      data: {
        name: "Top + Bottom Bundle",
        type: "bundle",
        description: "Save 10% when buying a scrub top and bottom together.",
        active: true,
        config: JSON.stringify({ discount: "10%", minItems: 2 }),
      },
    });

    runSeed();

    const afterFirstRun = await db.offerRecommendation.findUnique({ where: { id: stale.id } });
    assert.equal(afterFirstRun?.active, false, "the untouched seeded bundle row should be deactivated");

    // An admin can still turn it back on afterwards, and that decision
    // must survive the next deploy — the marker written above must stop
    // this block from ever re-deactivating it.
    await db.offerRecommendation.update({ where: { id: stale.id }, data: { active: true } });
    runSeed();
    const afterSecondRun = await db.offerRecommendation.findUnique({ where: { id: stale.id } });
    assert.equal(
      afterSecondRun?.active,
      true,
      "an admin's later reactivation must survive a re-seed once the row has been handled",
    );

    await db.offerRecommendation.delete({ where: { id: stale.id } });
  });

  it("never touches an offer an admin authored, even if it reuses the stale offer's name", async () => {
    await db.siteSetting.delete({ where: { key: "seed.unhonouredOffersHandledAt" } }).catch(() => {});
    const adminOffer = await db.offerRecommendation.create({
      data: {
        name: "Top + Bottom Bundle",
        type: "bundle",
        // Different description/config from the original seeded row —
        // an admin's own content, not what this fix should ever touch.
        description: "Admin-authored: 15% off, valid through Diwali.",
        active: true,
        config: JSON.stringify({ discount: "15%" }),
      },
    });

    runSeed();

    const after = await db.offerRecommendation.findUnique({ where: { id: adminOffer.id } });
    assert.equal(after?.active, true, "an admin-authored offer must never be deactivated by this fixup");

    await db.offerRecommendation.delete({ where: { id: adminOffer.id } });
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

/**
 * F-097 / F-273: the seed's category and size-chart upserts are create-only,
 * so correcting draft-catalog.ts only fixes a fresh database. Production
 * was seeded before the fix and keeps the old rows — an internal admin note
 * as /category/corporate-uniforms' public description, blazers / PE kit /
 * corporate wear / team kits / gowns pointed at charts for other garments,
 * and a Kids Wear chart whose labels don't match the sizes sold.
 * prisma/seed-corrections.ts rewrites exactly those legacy rows, once.
 *
 * These tests put the rows back into the shape the old seed left (the
 * constants below are the old values, copied from git history on purpose —
 * an independent statement of what production holds), then run the
 * correction.
 */
const LEGACY_CORPORATE_DESCRIPTION =
  "Executive and corporate wear — toggle on in site controls to list in the menu.";
const LEGACY_CHART_ASSIGNMENTS = [
  { slug: "ot-surgical-gowns", chart: "Adult Scrubs" },
  { slug: "patient-gowns", chart: "Adult Scrubs" },
  { slug: "blazers", chart: "School Shirts" },
  { slug: "sports-pe", chart: "School Trousers" },
  { slug: "corporate-uniforms", chart: "Adult Scrubs" },
  { slug: "sports-teams", chart: "Adult Scrubs" },
];
const LEGACY_KIDS_CHART = {
  columns: ["Age", "Height (cm)", "Chest (in)"],
  rows: [
    { Age: "2–3Y", "Height (cm)": "92–98", "Chest (in)": 21 },
    { Age: "4–5Y", "Height (cm)": "104–110", "Chest (in)": 22 },
    { Age: "6–7Y", "Height (cm)": "116–122", "Chest (in)": 24 },
    { Age: "8–9Y", "Height (cm)": "128–134", "Chest (in)": 26 },
    { Age: "10–11Y", "Height (cm)": "140–146", "Chest (in)": 28 },
    { Age: "12–13Y", "Height (cm)": "152–158", "Chest (in)": 30 },
    { Age: "13–14Y", "Height (cm)": "158–164", "Chest (in)": 32 },
  ],
};
// Charts the old seed never created — production has none of these.
const NEW_CHART_KEYS = ["corporate-apparel", "sportswear", "team-kit", "gowns", "made-to-measure"];

function draftChartForCategory(slug: string) {
  const key = draftCategories.find((c) => c.slug === slug)?.sizeChartKey;
  const chart = draftSizeCharts.find((c) => c.key === key);
  assert.ok(chart, `draft-catalog.ts should assign a size chart to ${slug}`);
  return chart;
}

async function putCatalogIntoLegacyState(): Promise<void> {
  await db.category.update({
    where: { slug: "corporate-uniforms" },
    data: { description: LEGACY_CORPORATE_DESCRIPTION },
  });
  for (const { slug, chart } of LEGACY_CHART_ASSIGNMENTS) {
    const legacyChart = await db.sizeChart.findFirstOrThrow({ where: { name: chart } });
    await db.category.update({ where: { slug }, data: { sizeChartId: legacyChart.id } });
  }
  await db.sizeChart.updateMany({
    where: { name: "Kids Wear" },
    data: {
      unit: "CM",
      columns: LEGACY_KIDS_CHART.columns as Prisma.InputJsonValue,
      rows: LEGACY_KIDS_CHART.rows as Prisma.InputJsonValue,
      notes: null,
    },
  });
  await db.sizeChart.deleteMany({
    where: { name: { in: draftSizeCharts.filter((c) => NEW_CHART_KEYS.includes(c.key)).map((c) => c.name) } },
  });
  await db.siteSetting.deleteMany({ where: { key: CATALOG_CONTENT_CORRECTION_MARKER_KEY } });
}

/** Leaves the database exactly as a freshly seeded one (and marked handled). */
async function restoreCatalog(): Promise<void> {
  await putCatalogIntoLegacyState();
  await runSeededContentCorrections(db);
}

describe("prisma/seed-corrections.ts catalogue corrections for already-seeded rows (F-097, F-273)", () => {
  after(restoreCatalog);

  it("is a no-op on a database seeded from the current source", async () => {
    const summary = await correctSeededCatalogContent(db);
    assert.deepEqual(summary, {
      descriptionsCorrected: 0,
      categoriesReassigned: 0,
      sizeChartsCreated: 0,
      sizeChartsRewritten: 0,
    });
  });

  it("rewrites the legacy description, chart assignments and Kids Wear chart, creating the charts production lacks", async () => {
    await putCatalogIntoLegacyState();

    const result = await runSeededContentCorrections(db);
    assert.deepEqual(result.catalog, {
      descriptionsCorrected: 1,
      categoriesReassigned: LEGACY_CHART_ASSIGNMENTS.length,
      sizeChartsCreated: NEW_CHART_KEYS.length,
      sizeChartsRewritten: 1,
    });

    // F-097
    const corporate = await db.category.findUniqueOrThrow({ where: { slug: "corporate-uniforms" } });
    const corporateDraft = draftCategories.find((c) => c.slug === "corporate-uniforms");
    assert.equal(corporate.description, corporateDraft?.description);
    assert.doesNotMatch(corporate.description ?? "", /toggle|site controls|admin/i);

    // F-273: each category now shows the chart draft-catalog.ts assigns it,
    // with that chart's seeded content.
    for (const { slug } of LEGACY_CHART_ASSIGNMENTS) {
      const expected = draftChartForCategory(slug);
      const category = await db.category.findUniqueOrThrow({ where: { slug }, include: { sizeChart: true } });
      assert.equal(category.sizeChart?.name, expected.name, `${slug} should use "${expected.name}"`);
      assert.equal(category.sizeChart?.unit, expected.unit);
      assert.deepEqual(category.sizeChart?.columns, expected.columns);
      assert.deepEqual(category.sizeChart?.rows, expected.rows);
      assert.equal(category.sizeChart?.notes ?? undefined, expected.notes);
    }

    const kidsDraft = draftSizeCharts.find((c) => c.key === "kids-wear");
    const kids = await db.sizeChart.findFirstOrThrow({ where: { name: "Kids Wear" } });
    assert.deepEqual(kids.columns, kidsDraft?.columns);
    assert.deepEqual(kids.rows, kidsDraft?.rows);
    assert.equal(kids.unit, "CM");

    // Nothing was duplicated: one chart per name.
    for (const chart of draftSizeCharts) {
      assert.equal(await db.sizeChart.count({ where: { name: chart.name } }), 1, `exactly one "${chart.name}" chart`);
    }
  });

  it("runs at most once per database: an admin's later choice survives the next deploy", async () => {
    await putCatalogIntoLegacyState();
    await runSeededContentCorrections(db);

    // The admin deliberately goes back to the old chart / copy afterwards.
    const legacyChart = await db.sizeChart.findFirstOrThrow({ where: { name: "School Shirts" } });
    await db.category.update({ where: { slug: "blazers" }, data: { sizeChartId: legacyChart.id } });
    await db.category.update({
      where: { slug: "corporate-uniforms" },
      data: { description: LEGACY_CORPORATE_DESCRIPTION },
    });

    const again = await runSeededContentCorrections(db);
    assert.deepEqual(again, { catalog: undefined, journeys: undefined });
    const blazers = await db.category.findUniqueOrThrow({ where: { slug: "blazers" }, include: { sizeChart: true } });
    assert.equal(blazers.sizeChart?.name, "School Shirts");
    const corporate = await db.category.findUniqueOrThrow({ where: { slug: "corporate-uniforms" } });
    assert.equal(corporate.description, LEGACY_CORPORATE_DESCRIPTION);
  });

  it("never touches a row an admin has edited or reassigned", async () => {
    await putCatalogIntoLegacyState();

    // Admin rewrote the corporate description, picked a different chart for
    // blazers, cleared sports-teams' chart, and changed one row of the Kids
    // Wear chart.
    await db.category.update({ where: { slug: "corporate-uniforms" }, data: { description: "Admin-written copy." } });
    const labCoats = await db.sizeChart.findFirstOrThrow({ where: { name: "Lab Coats" } });
    await db.category.update({ where: { slug: "blazers" }, data: { sizeChartId: labCoats.id } });
    await db.category.update({ where: { slug: "sports-teams" }, data: { sizeChartId: null } });
    await db.sizeChart.updateMany({
      where: { name: "Kids Wear" },
      data: {
        rows: LEGACY_KIDS_CHART.rows.map((row, i) =>
          i === 0 ? { ...row, "Chest (in)": 99 } : row,
        ) as Prisma.InputJsonValue,
      },
    });

    const summary = await correctSeededCatalogContent(db);

    assert.equal(summary.descriptionsCorrected, 0);
    assert.equal(summary.sizeChartsRewritten, 0);
    // Only the four still-legacy assignments move (gowns x2, sports-pe, corporate).
    assert.equal(summary.categoriesReassigned, 4);

    const corporate = await db.category.findUniqueOrThrow({ where: { slug: "corporate-uniforms" } });
    assert.equal(corporate.description, "Admin-written copy.");
    const blazers = await db.category.findUniqueOrThrow({ where: { slug: "blazers" }, include: { sizeChart: true } });
    assert.equal(blazers.sizeChart?.name, "Lab Coats");
    const teams = await db.category.findUniqueOrThrow({ where: { slug: "sports-teams" } });
    assert.equal(teams.sizeChartId, null);
    const kids = await db.sizeChart.findFirstOrThrow({ where: { name: "Kids Wear" } });
    assert.equal((kids.rows as { "Chest (in)": number }[])[0]["Chest (in)"], 99);
  });

  it("is applied by prisma/seed.ts itself, once", async () => {
    await putCatalogIntoLegacyState();

    runSeed();

    const corporate = await db.category.findUniqueOrThrow({ where: { slug: "corporate-uniforms" } });
    assert.doesNotMatch(corporate.description ?? "", /toggle|site controls/i);
    const blazers = await db.category.findUniqueOrThrow({ where: { slug: "blazers" }, include: { sizeChart: true } });
    assert.equal(blazers.sizeChart?.name, draftChartForCategory("blazers").name);
    const marker = await db.siteSetting.findUnique({ where: { key: CATALOG_CONTENT_CORRECTION_MARKER_KEY } });
    assert.ok(marker, "the seed should record that the catalogue correction has run");
  });
});

/**
 * F-070: production's seeded customer journeys. The fresh seed now creates
 * them DRAFT with one step each and no HERO10 text, but the rows an old seed
 * created there were ACTIVE (they send the moment Brevo is enabled, with no
 * approval step), resent one template 3-5 times, and told every subscriber
 * to "use code HERO10" — a code that was never a real Discount row.
 */
const WELCOME_TEMPLATE_ID = "seed-welcome-email";
const CART_TEMPLATE_ID = "seed-cart-abandon-email";
const POST_PURCHASE_TEMPLATE_ID = "seed-post-purchase-email";
const BULK_ACK_TEMPLATE_ID = "seed-bulk-followup-wa";
const BULK_QUOTE_TEMPLATE_ID = "seed-bulk-followup-quote-wa";
const SEEDED_TEMPLATE_IDS = [
  WELCOME_TEMPLATE_ID,
  CART_TEMPLATE_ID,
  POST_PURCHASE_TEMPLATE_ID,
  BULK_ACK_TEMPLATE_ID,
  BULK_QUOTE_TEMPLATE_ID,
];
const SEEDED_JOURNEY_SLUGS = ["welcome-series", "abandoned-cart", "post-purchase", "bulk-order-followup"];

const LEGACY_JOURNEY_FIXTURES: {
  slug: string;
  name: string;
  description: string;
  trigger: string;
  steps: { name: string; delayHours: number; templateId: string }[];
}[] = [
  {
    slug: "welcome-series",
    name: "Welcome Journey",
    description: "Day 0 welcome, Day 2 best sellers, Day 5 fabric science, Day 7 offer.",
    trigger: "newsletter_signup",
    steps: [
      { name: "Welcome email", delayHours: 0, templateId: WELCOME_TEMPLATE_ID },
      { name: "Best sellers spotlight", delayHours: 48, templateId: WELCOME_TEMPLATE_ID },
      { name: "Fabric science guide", delayHours: 120, templateId: WELCOME_TEMPLATE_ID },
      { name: "First purchase offer", delayHours: 168, templateId: WELCOME_TEMPLATE_ID },
    ],
  },
  {
    slug: "abandoned-cart",
    name: "Abandoned Cart Journey",
    description: "1h reminder, 24h benefit nudge, 48h offer (when email known).",
    trigger: "cart_abandoned",
    steps: [
      { name: "Cart reminder", delayHours: 1, templateId: CART_TEMPLATE_ID },
      { name: "Benefit-led nudge", delayHours: 24, templateId: CART_TEMPLATE_ID },
      { name: "Offer reminder", delayHours: 48, templateId: CART_TEMPLATE_ID },
    ],
  },
  {
    slug: "post-purchase",
    name: "Post-Purchase Journey",
    description: "Thank you, care tips, review request, cross-sell, repeat reminder.",
    trigger: "order_created",
    steps: [
      { name: "Thank you email", delayHours: 0, templateId: POST_PURCHASE_TEMPLATE_ID },
      { name: "Care instructions", delayHours: 24, templateId: POST_PURCHASE_TEMPLATE_ID },
      { name: "Review request", delayHours: 72, templateId: POST_PURCHASE_TEMPLATE_ID },
      { name: "Cross-sell spotlight", delayHours: 168, templateId: WELCOME_TEMPLATE_ID },
      { name: "Repeat purchase reminder", delayHours: 720, templateId: WELCOME_TEMPLATE_ID },
    ],
  },
];

async function snapshotSeededJourneyContent() {
  const templates = await db.messageTemplate.findMany({
    where: { id: { in: SEEDED_TEMPLATE_IDS } },
    orderBy: { id: "asc" },
    select: { id: true, name: true, channel: true, subject: true, body: true, variables: true },
  });
  const journeys = await db.customerJourney.findMany({
    where: { slug: { in: SEEDED_JOURNEY_SLUGS } },
    orderBy: { slug: "asc" },
    select: {
      slug: true,
      name: true,
      description: true,
      trigger: true,
      steps: {
        orderBy: { sortOrder: "asc" },
        select: { sortOrder: true, name: true, delayHours: true, channel: true, templateId: true, notes: true },
      },
    },
  });
  return { templates, journeys };
}

async function putJourneysIntoLegacyState(): Promise<void> {
  await db.messageTemplate.update({
    where: { id: WELCOME_TEMPLATE_ID },
    data: {
      name: "Welcome — 10% Off First Order",
      subject: "Welcome to DAAKYKA — Your 10% Hero Discount",
      body: "Hi {{first_name}},\n\nWelcome to DAAKYKA Apparels. Use code HERO10 for 10% off your first scrub set.\n\nShop best sellers: {{shop_url}}",
    },
  });
  await db.messageTemplate.update({
    where: { id: CART_TEMPLATE_ID },
    data: {
      body: "Hi {{first_name}},\n\nYour DAAKYKA scrub set is waiting. Complete your order: {{shop_url}}/shop\n\nUse code HERO10 on your first purchase.",
    },
  });
  await db.messageTemplate.update({ where: { id: BULK_ACK_TEMPLATE_ID }, data: { name: "Bulk Order Follow-up" } });

  for (const fixture of LEGACY_JOURNEY_FIXTURES) {
    const journey = await db.customerJourney.update({
      where: { slug: fixture.slug },
      data: {
        name: fixture.name,
        description: fixture.description,
        trigger: fixture.trigger,
        status: "ACTIVE",
      },
    });
    await db.journeyStep.deleteMany({ where: { journeyId: journey.id } });
    await db.journeyStep.createMany({
      data: fixture.steps.map((step, sortOrder) => ({
        journeyId: journey.id,
        sortOrder,
        name: step.name,
        delayHours: step.delayHours,
        channel: "EMAIL" as const,
        templateId: step.templateId,
      })),
    });
  }

  // bulk-order-followup's 48h quote follow-up reused the acknowledgement
  // template; the distinct follow-up template did not exist.
  await db.journeyStep.updateMany({
    where: { journey: { slug: "bulk-order-followup" }, sortOrder: 2 },
    data: { templateId: BULK_ACK_TEMPLATE_ID },
  });
  await db.messageTemplate.deleteMany({ where: { id: BULK_QUOTE_TEMPLATE_ID } });

  await db.siteSetting.deleteMany({ where: { key: JOURNEY_CONTENT_CORRECTION_MARKER_KEY } });
}

describe("prisma/seed-corrections.ts journey corrections for already-seeded rows (F-070)", () => {
  let fresh: Awaited<ReturnType<typeof snapshotSeededJourneyContent>>;

  before(async () => {
    fresh = await snapshotSeededJourneyContent();
  });

  after(async () => {
    await putJourneysIntoLegacyState();
    await runSeededContentCorrections(db);
  });

  it("is a no-op on a database seeded from the current source", async () => {
    const summary = await correctSeededJourneyContent(db);
    assert.deepEqual(summary, {
      templatesCorrected: 0,
      journeysCollapsed: 0,
      journeysDeactivated: 0,
      stepsRemoved: 0,
      stepsRepointed: 0,
    });
    assert.deepEqual(await snapshotSeededJourneyContent(), fresh);
  });

  it("turns production's old journeys into exactly what a fresh seed creates", async () => {
    await putJourneysIntoLegacyState();
    // Sanity: the fixture really is the old, broken shape.
    const legacy = await snapshotSeededJourneyContent();
    assert.match(legacy.templates.find((t) => t.id === WELCOME_TEMPLATE_ID)?.body ?? "", /HERO10/);
    assert.equal(legacy.journeys.find((j) => j.slug === "welcome-series")?.steps.length, 4);

    const result = await runSeededContentCorrections(db);
    assert.deepEqual(result.journeys, {
      templatesCorrected: 3,
      journeysCollapsed: 3,
      journeysDeactivated: 3,
      stepsRemoved: 3 + 2 + 4,
      stepsRepointed: 1,
    });

    // Template copy, journey descriptions and steps now match the fresh
    // seed field for field — one step each, nothing mentioning HERO10.
    assert.deepEqual(await snapshotSeededJourneyContent(), fresh);

    // The marketing journeys are not ACTIVE any more; bulk stays ACTIVE (it
    // is what notifies the owner of a new institutional lead).
    const statuses = Object.fromEntries(
      (await db.customerJourney.findMany({ where: { slug: { in: SEEDED_JOURNEY_SLUGS } } })).map((j) => [j.slug, j.status]),
    );
    assert.deepEqual(statuses, {
      "welcome-series": "DRAFT",
      "abandoned-cart": "DRAFT",
      "post-purchase": "DRAFT",
      "bulk-order-followup": "ACTIVE",
    });
    assert.equal(await db.messageTemplate.count({ where: { body: { contains: "HERO10" } } }), 0);
  });

  it("runs at most once per database: re-activating a journey afterwards sticks", async () => {
    await putJourneysIntoLegacyState();
    await runSeededContentCorrections(db);

    await db.customerJourney.update({ where: { slug: "welcome-series" }, data: { status: "ACTIVE" } });
    const again = await runSeededContentCorrections(db);
    assert.deepEqual(again, { catalog: undefined, journeys: undefined });

    const journey = await db.customerJourney.findUniqueOrThrow({ where: { slug: "welcome-series" } });
    assert.equal(journey.status, "ACTIVE");
  });

  it("leaves a journey or template an admin has touched alone", async () => {
    await putJourneysIntoLegacyState();

    // welcome-series: the admin rewrote the description (and left it ACTIVE).
    await db.customerJourney.update({
      where: { slug: "welcome-series" },
      data: { description: "Our own welcome flow." },
    });
    // abandoned-cart: the admin replaced the reminder copy.
    await db.messageTemplate.update({
      where: { id: CART_TEMPLATE_ID },
      data: { body: "Hi {{first_name}}, we saved your cart: {{shop_url}}/shop" },
    });
    // post-purchase: the admin paused it.
    await db.customerJourney.update({ where: { slug: "post-purchase" }, data: { status: "PAUSED" } });

    await correctSeededJourneyContent(db);

    const welcome = await db.customerJourney.findUniqueOrThrow({
      where: { slug: "welcome-series" },
      include: { steps: true },
    });
    assert.equal(welcome.description, "Our own welcome flow.");
    assert.equal(welcome.status, "ACTIVE", "an edited journey is not paused behind the admin's back");
    assert.equal(welcome.steps.length, 4, "an edited journey keeps its steps");

    // ...yet its still-untouched template's HERO10 text is replaced.
    const welcomeTemplate = await db.messageTemplate.findUniqueOrThrow({ where: { id: WELCOME_TEMPLATE_ID } });
    assert.doesNotMatch(welcomeTemplate.body, /HERO10/);

    const cartTemplate = await db.messageTemplate.findUniqueOrThrow({ where: { id: CART_TEMPLATE_ID } });
    assert.equal(cartTemplate.body, "Hi {{first_name}}, we saved your cart: {{shop_url}}/shop");

    const postPurchase = await db.customerJourney.findUniqueOrThrow({
      where: { slug: "post-purchase" },
      include: { steps: true },
    });
    assert.equal(postPurchase.status, "PAUSED", "a paused journey stays paused");
    assert.equal(postPurchase.steps.length, 1, "its duplicate steps are still removed");
  });

  it("is applied by prisma/seed.ts itself", async () => {
    await putJourneysIntoLegacyState();

    runSeed();

    assert.deepEqual(await snapshotSeededJourneyContent(), fresh);
    const marker = await db.siteSetting.findUnique({ where: { key: JOURNEY_CONTENT_CORRECTION_MARKER_KEY } });
    assert.ok(marker, "the seed should record that the journey correction has run");
    const welcome = await db.customerJourney.findUniqueOrThrow({ where: { slug: "welcome-series" } });
    assert.equal(welcome.status, "DRAFT");
  });
});
