import { isDeepStrictEqual } from "node:util";
import {
  draftCategories,
  draftSizeCharts,
  type DraftSizeChart,
} from "../src/data/catalog/draft-catalog";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";

/**
 * One-time corrections for rows an EARLIER version of the seed already
 * created — most importantly production's.
 *
 * Every seed upsert is create-only (`update: {}`), so fixing the seed's
 * source text (draft-catalog.ts, prisma/seed.ts) only changes what a *fresh*
 * database gets. A database seeded before the fix keeps the old rows
 * forever, which is where F-097, F-273 and F-070 were observed. Each
 * correction below:
 *
 * - matches ONLY a row that still holds the exact content the old seed
 *   wrote (name + text, or the exact chart assignment) — never a looser
 *   match, so anything an admin has since edited, or authored under the
 *   same name, is left alone;
 * - is idempotent (a second run finds nothing left to match);
 * - runs at most once per database, guarded by a marker row (see
 *   runSeededContentCorrections), so a later admin decision — re-assigning
 *   an old size chart, re-activating a journey — sticks across the next
 *   deploy, exactly like the legacy-account and unhonoured-offer steps in
 *   prisma/seed.ts.
 *
 * Takes its Prisma client as a parameter, and creates none itself, so it is
 * import-safe (a test can import it) and callable against the test
 * connection. Deliberately no transactions: each statement is an exact-match
 * guarded write, and the marker is only written after all of them, so a
 * crash part-way simply re-runs the remainder on the next deploy — and
 * transaction-pooled connections never see an interactive transaction.
 */

/** Same "seed." namespace and rationale as the markers in prisma/seed.ts. */
export const CATALOG_CONTENT_CORRECTION_MARKER_KEY = "seed.catalogContentCorrectedAt";
export const JOURNEY_CONTENT_CORRECTION_MARKER_KEY = "seed.journeyContentCorrectedAt";

type Db = PrismaClient | Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Catalogue: F-097 (internal note published as a category description) and
// F-273 (size charts attached to the wrong garments)
// ---------------------------------------------------------------------------

/** F-097: what the old seed stored as corporate-uniforms' public description. */
const LEGACY_CORPORATE_UNIFORMS_DESCRIPTION =
  "Executive and corporate wear — toggle on in site controls to list in the menu.";

/**
 * F-273: category -> the (wrong) chart the old seed assigned it. The
 * replacement is NOT repeated here: it is whatever draft-catalog.ts's
 * category entry points at today, so the two can't drift apart (a test
 * pins that every legacy chart name differs from its current target).
 */
const LEGACY_CATEGORY_SIZE_CHARTS: { slug: string; legacyChartName: string }[] = [
  { slug: "ot-surgical-gowns", legacyChartName: "Adult Scrubs" },
  { slug: "patient-gowns", legacyChartName: "Adult Scrubs" },
  { slug: "blazers", legacyChartName: "School Shirts" },
  { slug: "sports-pe", legacyChartName: "School Trousers" },
  { slug: "corporate-uniforms", legacyChartName: "Adult Scrubs" },
  { slug: "sports-teams", legacyChartName: "Adult Scrubs" },
];

/**
 * F-273: the "Kids Wear" chart as the old seed wrote it — en-dash age labels
 * that never matched the hyphenated variant sizes ("2-3Y"), two ages
 * (12-13Y, 13-14Y) no product is sold in, and a "Chest (in)" column inside a
 * chart whose unit (and the PDP's "Measurements in centimeters" footer) is cm.
 */
const LEGACY_KIDS_WEAR_CHART = {
  name: "Kids Wear",
  unit: "CM",
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
} as const;

export interface CatalogCorrectionSummary {
  descriptionsCorrected: number;
  categoriesReassigned: number;
  sizeChartsCreated: number;
  sizeChartsRewritten: number;
}

function chartData(chart: DraftSizeChart) {
  return {
    name: chart.name,
    unit: chart.unit,
    columns: chart.columns as Prisma.InputJsonValue,
    rows: chart.rows as Prisma.InputJsonValue,
    notes: chart.notes ?? null,
  };
}

export async function correctSeededCatalogContent(db: Db): Promise<CatalogCorrectionSummary> {
  const summary: CatalogCorrectionSummary = {
    descriptionsCorrected: 0,
    categoriesReassigned: 0,
    sizeChartsCreated: 0,
    sizeChartsRewritten: 0,
  };

  // F-097: exact-match updateMany — a description an admin has already
  // rewritten (or that was never seeded) simply matches no row.
  const corporate = draftCategories.find((c) => c.slug === "corporate-uniforms");
  if (corporate) {
    const result = await db.category.updateMany({
      where: { slug: corporate.slug, description: LEGACY_CORPORATE_UNIFORMS_DESCRIPTION },
      data: { description: corporate.description },
    });
    summary.descriptionsCorrected += result.count;
  }

  // F-273: Kids Wear chart. Compared with isDeepStrictEqual, not
  // JSON.stringify — Postgres jsonb does not preserve object key order.
  const kidsTarget = draftSizeCharts.find((c) => c.key === "kids-wear");
  if (kidsTarget) {
    const kidsCharts = await db.sizeChart.findMany({ where: { name: LEGACY_KIDS_WEAR_CHART.name } });
    for (const chart of kidsCharts) {
      const untouched =
        chart.unit === LEGACY_KIDS_WEAR_CHART.unit &&
        chart.notes === null &&
        isDeepStrictEqual(chart.columns, LEGACY_KIDS_WEAR_CHART.columns) &&
        isDeepStrictEqual(chart.rows, LEGACY_KIDS_WEAR_CHART.rows);
      if (!untouched) continue;
      await db.sizeChart.update({ where: { id: chart.id }, data: chartData(kidsTarget) });
      summary.sizeChartsRewritten += 1;
    }
  }

  // F-273: category -> chart assignments. Only a category still pointing at
  // the exact legacy chart is moved; the new chart is looked up by name and
  // created when absent — production's deploy never runs seed-catalog.ts,
  // so the five new charts don't exist there until something creates them.
  for (const { slug, legacyChartName } of LEGACY_CATEGORY_SIZE_CHARTS) {
    const targetKey = draftCategories.find((c) => c.slug === slug)?.sizeChartKey;
    const target = draftSizeCharts.find((c) => c.key === targetKey);
    if (!target) continue;

    const category = await db.category.findUnique({
      where: { slug },
      select: { id: true, sizeChartId: true, sizeChart: { select: { name: true } } },
    });
    if (!category?.sizeChartId || category.sizeChart?.name !== legacyChartName) continue;

    let targetChart = await db.sizeChart.findFirst({ where: { name: target.name }, select: { id: true } });
    if (!targetChart) {
      targetChart = await db.sizeChart.create({ data: chartData(target), select: { id: true } });
      summary.sizeChartsCreated += 1;
    }

    const result = await db.category.updateMany({
      where: { id: category.id, sizeChartId: category.sizeChartId },
      data: { sizeChartId: targetChart.id },
    });
    summary.categoriesReassigned += result.count;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Journeys and their message templates: F-070 (seeded ACTIVE journeys that
// email a non-existent HERO10 code, resend one template 3-5 times, and pitch
// a "first order" offer to people who just bought)
// ---------------------------------------------------------------------------

type StepChannel = "EMAIL" | "WHATSAPP" | "ADMIN_NOTIFICATION";

interface LegacyStep {
  sortOrder: number;
  name: string;
  delayHours: number;
  channel: StepChannel;
  templateId: string | null;
}

interface LegacyJourney {
  slug: string;
  name: string;
  description: string;
  trigger: string;
  steps: LegacyStep[];
  /** What prisma/seed.ts gives a fresh database's journey instead. */
  replacementDescription: string;
}

const WELCOME_TEMPLATE_ID = "seed-welcome-email";
const CART_TEMPLATE_ID = "seed-cart-abandon-email";
const POST_PURCHASE_TEMPLATE_ID = "seed-post-purchase-email";
const BULK_ACK_TEMPLATE_ID = "seed-bulk-followup-wa";
const BULK_QUOTE_TEMPLATE_ID = "seed-bulk-followup-quote-wa";

const LEGACY_MARKETING_JOURNEYS: LegacyJourney[] = [
  {
    slug: "welcome-series",
    name: "Welcome Journey",
    description: "Day 0 welcome, Day 2 best sellers, Day 5 fabric science, Day 7 offer.",
    trigger: "newsletter_signup",
    replacementDescription: "Single welcome email on newsletter confirmation. Review, then set to Active.",
    steps: [
      { sortOrder: 0, name: "Welcome email", delayHours: 0, channel: "EMAIL", templateId: WELCOME_TEMPLATE_ID },
      { sortOrder: 1, name: "Best sellers spotlight", delayHours: 48, channel: "EMAIL", templateId: WELCOME_TEMPLATE_ID },
      { sortOrder: 2, name: "Fabric science guide", delayHours: 120, channel: "EMAIL", templateId: WELCOME_TEMPLATE_ID },
      { sortOrder: 3, name: "First purchase offer", delayHours: 168, channel: "EMAIL", templateId: WELCOME_TEMPLATE_ID },
    ],
  },
  {
    slug: "abandoned-cart",
    name: "Abandoned Cart Journey",
    description: "1h reminder, 24h benefit nudge, 48h offer (when email known).",
    trigger: "cart_abandoned",
    replacementDescription: "Single reminder when email is known. Review, then set to Active.",
    steps: [
      { sortOrder: 0, name: "Cart reminder", delayHours: 1, channel: "EMAIL", templateId: CART_TEMPLATE_ID },
      { sortOrder: 1, name: "Benefit-led nudge", delayHours: 24, channel: "EMAIL", templateId: CART_TEMPLATE_ID },
      { sortOrder: 2, name: "Offer reminder", delayHours: 48, channel: "EMAIL", templateId: CART_TEMPLATE_ID },
    ],
  },
  {
    slug: "post-purchase",
    name: "Post-Purchase Journey",
    description: "Thank you, care tips, review request, cross-sell, repeat reminder.",
    trigger: "order_created",
    replacementDescription: "Single thank-you email after purchase. Review, then set to Active.",
    steps: [
      { sortOrder: 0, name: "Thank you email", delayHours: 0, channel: "EMAIL", templateId: POST_PURCHASE_TEMPLATE_ID },
      { sortOrder: 1, name: "Care instructions", delayHours: 24, channel: "EMAIL", templateId: POST_PURCHASE_TEMPLATE_ID },
      { sortOrder: 2, name: "Review request", delayHours: 72, channel: "EMAIL", templateId: POST_PURCHASE_TEMPLATE_ID },
      // These two re-sent the Welcome / "use HERO10 on your first scrub set"
      // email to someone who had just bought.
      { sortOrder: 3, name: "Cross-sell spotlight", delayHours: 168, channel: "EMAIL", templateId: WELCOME_TEMPLATE_ID },
      { sortOrder: 4, name: "Repeat purchase reminder", delayHours: 720, channel: "EMAIL", templateId: WELCOME_TEMPLATE_ID },
    ],
  },
];

interface TemplateCorrection {
  id: string;
  legacy: { name: string; subject: string | null; body: string };
  replacement: { name: string; subject: string | null; body: string };
}

const TEMPLATE_CORRECTIONS: TemplateCorrection[] = [
  {
    id: WELCOME_TEMPLATE_ID,
    legacy: {
      name: "Welcome — 10% Off First Order",
      subject: "Welcome to DAAKYKA — Your 10% Hero Discount",
      body: "Hi {{first_name}},\n\nWelcome to DAAKYKA Apparels. Use code HERO10 for 10% off your first scrub set.\n\nShop best sellers: {{shop_url}}",
    },
    replacement: {
      name: "Welcome Email",
      subject: "Welcome to DAAKYKA Apparels",
      body: "Hi {{first_name}},\n\nWelcome to DAAKYKA Apparels. Explore our medical scrubs and uniforms, designed for long shifts.\n\nShop now: {{shop_url}}",
    },
  },
  {
    id: CART_TEMPLATE_ID,
    legacy: {
      name: "Abandoned Cart Reminder",
      subject: "You left something in your cart — {{first_name}}",
      body: "Hi {{first_name}},\n\nYour DAAKYKA scrub set is waiting. Complete your order: {{shop_url}}/shop\n\nUse code HERO10 on your first purchase.",
    },
    replacement: {
      name: "Abandoned Cart Reminder",
      subject: "You left something in your cart — {{first_name}}",
      body: "Hi {{first_name}},\n\nYour DAAKYKA scrub set is still waiting for you. Complete your order: {{shop_url}}/shop",
    },
  },
  {
    // The bulk acknowledgement keeps its text; it is only renamed, because
    // the quote follow-up (below) used to reuse this very template.
    id: BULK_ACK_TEMPLATE_ID,
    legacy: {
      name: "Bulk Order Follow-up",
      subject: null,
      body: "Hi {{contact_name}}, thank you for your bulk uniform enquiry at {{organization}}. Our team will share a custom quote within 1–2 business days.",
    },
    replacement: {
      name: "Bulk Order Acknowledgement",
      subject: null,
      body: "Hi {{contact_name}}, thank you for your bulk uniform enquiry at {{organization}}. Our team will share a custom quote within 1–2 business days.",
    },
  },
];

/** The distinct "quote follow-up" template a fresh seed creates. */
const BULK_QUOTE_TEMPLATE = {
  id: BULK_QUOTE_TEMPLATE_ID,
  name: "Bulk Order Quote Follow-up",
  channel: "WHATSAPP" as const,
  body: "Hi {{contact_name}}, just checking in on {{organization}}'s uniform quote — let us know if you have any questions or would like to adjust quantities or sizes before we finalize it.",
  variables: JSON.stringify(["contact_name", "organization"]),
};

export interface JourneyCorrectionSummary {
  templatesCorrected: number;
  journeysCollapsed: number;
  journeysDeactivated: number;
  stepsRemoved: number;
  stepsRepointed: number;
}

function sameSteps(
  actual: { sortOrder: number; name: string; delayHours: number; channel: string; templateId: string | null; notes: string | null }[],
  expected: LegacyStep[],
): boolean {
  if (actual.length !== expected.length) return false;
  const bySortOrder = [...actual].sort((a, b) => a.sortOrder - b.sortOrder);
  return expected.every((step, index) => {
    const row = bySortOrder[index];
    return (
      row.sortOrder === step.sortOrder &&
      row.name === step.name &&
      row.delayHours === step.delayHours &&
      row.channel === step.channel &&
      row.templateId === step.templateId &&
      row.notes === null
    );
  });
}

export async function correctSeededJourneyContent(db: Db): Promise<JourneyCorrectionSummary> {
  const summary: JourneyCorrectionSummary = {
    templatesCorrected: 0,
    journeysCollapsed: 0,
    journeysDeactivated: 0,
    stepsRemoved: 0,
    stepsRepointed: 0,
  };

  // 1. Template copy. The HERO10 text is the shopper-facing defect (the code
  // was never a real Discount row — checkout answered "Invalid discount
  // code"), so it is replaced wherever the template is still exactly what
  // the old seed wrote, even when the journey around it was restructured.
  for (const { id, legacy, replacement } of TEMPLATE_CORRECTIONS) {
    const result = await db.messageTemplate.updateMany({
      where: { id, name: legacy.name, subject: legacy.subject, body: legacy.body },
      data: replacement,
    });
    summary.templatesCorrected += result.count;
  }

  // 2. The three marketing journeys. A journey is only touched when it is,
  // field for field and step for step, the one the old seed created: the
  // same email resent 3-5 times, ACTIVE, which sends automatically the
  // moment Brevo is enabled with no approval step. The first step (the real
  // welcome / reminder / thank-you) is kept; the duplicate steps are
  // removed, the journey drops back to DRAFT for the owner to review, and
  // any in-flight enrollment simply stops being processed while it is not
  // ACTIVE (processDueEnrollments skips non-ACTIVE journeys).
  for (const legacy of LEGACY_MARKETING_JOURNEYS) {
    const journey = await db.customerJourney.findUnique({
      where: { slug: legacy.slug },
      include: { steps: true },
    });
    if (!journey) continue;

    const untouched =
      journey.name === legacy.name &&
      journey.description === legacy.description &&
      journey.trigger === legacy.trigger &&
      sameSteps(journey.steps, legacy.steps);
    if (!untouched) continue;

    const removed = await db.journeyStep.deleteMany({
      where: { journeyId: journey.id, sortOrder: { gte: 1 } },
    });
    summary.stepsRemoved += removed.count;

    const deactivate = journey.status === "ACTIVE";
    await db.customerJourney.update({
      where: { id: journey.id },
      data: {
        description: legacy.replacementDescription,
        ...(deactivate ? { status: "DRAFT" as const } : {}),
      },
    });
    summary.journeysCollapsed += 1;
    if (deactivate) summary.journeysDeactivated += 1;
  }

  // 3. bulk-order-followup's 48h "quote follow-up" re-sent the 0h
  // acknowledgement verbatim (it reused the same template). Point just that
  // step at the distinct follow-up template; the journey stays ACTIVE — it is
  // what notifies the owner of a new institutional lead.
  const quoteStep = await db.journeyStep.findFirst({
    where: {
      journey: { slug: "bulk-order-followup" },
      sortOrder: 2,
      name: "Quote follow-up",
      delayHours: 48,
      channel: "WHATSAPP",
      templateId: BULK_ACK_TEMPLATE_ID,
    },
    select: { id: true },
  });
  if (quoteStep) {
    await db.messageTemplate.upsert({
      where: { id: BULK_QUOTE_TEMPLATE.id },
      update: {},
      create: BULK_QUOTE_TEMPLATE,
    });
    await db.journeyStep.update({
      where: { id: quoteStep.id },
      data: { templateId: BULK_QUOTE_TEMPLATE.id },
    });
    summary.stepsRepointed += 1;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Entry point used by prisma/seed.ts
// ---------------------------------------------------------------------------

async function runOnce<T>(
  db: Db,
  markerKey: string,
  label: string,
  correct: (db: Db) => Promise<T>,
): Promise<T | undefined> {
  const handled = await db.siteSetting.findUnique({ where: { key: markerKey } });
  if (handled) return undefined;

  const summary = await correct(db);
  console.log(`[seed] One-time ${label} correction: ${JSON.stringify(summary)}`);

  await db.siteSetting.upsert({
    where: { key: markerKey },
    update: {},
    create: { key: markerKey, value: new Date().toISOString() },
  });
  return summary;
}

/**
 * Runs each correction at most once per database. On a fresh database
 * (nothing seeded yet, or seeded from the current source) every correction
 * simply finds nothing to match and just records its marker.
 */
export async function runSeededContentCorrections(
  db: Db,
): Promise<{ catalog?: CatalogCorrectionSummary; journeys?: JourneyCorrectionSummary }> {
  return {
    catalog: await runOnce(db, CATALOG_CONTENT_CORRECTION_MARKER_KEY, "catalogue content", correctSeededCatalogContent),
    journeys: await runOnce(db, JOURNEY_CONTENT_CORRECTION_MARKER_KEY, "journey content", correctSeededJourneyContent),
  };
}
