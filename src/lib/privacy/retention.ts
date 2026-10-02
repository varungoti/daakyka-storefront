import { db } from "@/lib/db";
import { CREDENTIAL_EMAIL_KINDS } from "@/lib/engagement/outbox";
import { REDACTED_BODY, isSealedBody, sealOutboxBody } from "@/lib/engagement/outbox-seal";
import { ERASED_EMAIL, anonymiseOrdersById } from "@/lib/privacy/anonymise-orders";

/**
 * F-316: a retention limit for every table that holds personal data. Until
 * now nothing ever expired — EmailOutbox (full email bodies), AdminNotification
 * (customer addresses and amounts), journey and campaign logs, enquiries,
 * leads, unsubscribed newsletter rows and a 3-year-old audit trail all grew
 * without bound; the only cleanup in the codebase was the rate-limit bucket
 * sweep.
 *
 * RETENTION_RULES is the written schedule: one row per table with its age
 * limit and what happens at that age (delete the row, or anonymise it in
 * place where the row itself still has a use — a campaign's delivery count,
 * an order's tax figures). The daily /api/cron/retention job enforces it, in
 * bounded batches so it never holds a long lock or outruns the function
 * timeout; src/app/privacy-policy/page.tsx prints the same table, so what the
 * policy says and what the code does cannot drift.
 *
 * THE PERIODS ARE DEFAULTS FOR COUNSEL TO CONFIRM, not legal advice: the GST
 * floor for orders in particular (6 years here; CGST s.36 says 72 months from
 * the due date of the annual return) and the DPDP Act s.8(7) "erase once the
 * purpose is served" reading behind the rest. Change a number here and the
 * policy page follows.
 *
 * Deliberately NOT age-expired: Customer accounts (erased on request —
 * erase.ts — not on a timer), Reviews and WhatsApp opt-in records.
 * Order figures are never deleted, only anonymised, and only after the floor.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionRule {
  /** Stable key used in the cron's result and the audit row. */
  id: string;
  /** What is kept, in the words the privacy policy uses. */
  subject: string;
  action: "delete" | "anonymise";
  maxAgeDays: number;
  /** False for housekeeping that holds no personal data — kept out of the
   * privacy policy's list (the admin page still shows it). Default true. */
  inPolicy?: boolean;
  /** Handles up to `limit` rows older than `cutoff` and returns how many it
   * handled. Idempotent: a row a previous run already handled no longer
   * matches. */
  run: (cutoff: Date, limit: number) => Promise<number>;
}

/** One SELECT of ids (bounded by `limit`), then one write by id — never an
 * unbounded `deleteMany(where)` that could lock a table for minutes. */
async function deleteInBatch(
  find: (limit: number) => Promise<{ id: string }[]>,
  remove: (ids: string[]) => Promise<{ count: number }>,
  limit: number,
): Promise<number> {
  const rows = await find(limit);
  if (rows.length === 0) return 0;
  return (await remove(rows.map((row) => row.id))).count;
}

export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    id: "email-outbox-credentials",
    subject: "Sign-in, password-reset and order-access links in queued emails (never kept readable)",
    action: "anonymise",
    // Not age-based: a credential must not sit readable at all. New rows are
    // sealed or blanked as they are written (outbox.ts); this sweeps the rows
    // queued before that existed, once, and then finds nothing.
    maxAgeDays: 0,
    inPolicy: false,
    run: async (_cutoff, limit) => {
      // Delivered / failed / expired: nothing will ever send them — blank them.
      const terminal = await db.emailOutbox.findMany({
        where: { kind: { in: [...CREDENTIAL_EMAIL_KINDS] }, status: { in: ["SENT", "FAILED", "EXPIRED"] }, NOT: { html: REDACTED_BODY } },
        select: { id: true },
        take: limit,
      });
      const blanked =
        terminal.length > 0
          ? (
              await db.emailOutbox.updateMany({
                where: { id: { in: terminal.map((row) => row.id) } },
                data: { html: REDACTED_BODY, text: null },
              })
            ).count
          : 0;
      // Still waiting to be sent: seal in place, so the drain can still deliver them.
      const waiting = await db.emailOutbox.findMany({
        where: { kind: { in: [...CREDENTIAL_EMAIL_KINDS] }, status: "PENDING", NOT: { html: { startsWith: "sealed:v1:" } } },
        select: { id: true, html: true, text: true },
        take: limit,
      });
      let sealed = 0;
      for (const row of waiting) {
        if (isSealedBody(row.html) || row.html === REDACTED_BODY) continue;
        await db.emailOutbox.update({
          where: { id: row.id },
          data: { html: sealOutboxBody({ html: row.html, text: row.text }), text: null },
        });
        sealed += 1;
      }
      return blanked + sealed;
    },
  },
  {
    id: "email-outbox-sent",
    subject: "Copies of emails we sent you (recipient, subject and delivery status)",
    action: "delete",
    maxAgeDays: 90,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) =>
          db.emailOutbox.findMany({
            where: { status: { in: ["SENT", "FAILED", "EXPIRED"] }, createdAt: { lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => db.emailOutbox.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
  {
    id: "email-outbox-stuck",
    subject: "Emails that could never be delivered (given up on, content removed)",
    action: "anonymise",
    maxAgeDays: 60,
    run: async (cutoff, limit) => {
      // Still PENDING after this long means the provider was never reachable;
      // the email is stale anyway. Mark it EXPIRED and drop its body — the row
      // itself is deleted by email-outbox-sent once it is 90 days old.
      const rows = await db.emailOutbox.findMany({
        where: { status: "PENDING", createdAt: { lt: cutoff } },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      return (
        await db.emailOutbox.updateMany({
          where: { id: { in: rows.map((row) => row.id) }, status: "PENDING" },
          data: { status: "EXPIRED", html: REDACTED_BODY, text: null, lockedAt: null },
        })
      ).count;
    },
  },
  {
    id: "admin-notifications",
    subject: "Internal order and enquiry alerts (they quote your email address)",
    action: "delete",
    maxAgeDays: 365,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) => db.adminNotification.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take }),
        (ids) => db.adminNotification.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
  {
    id: "journey-events",
    subject: "Automated-message logs (which journey message went to which address)",
    action: "delete",
    maxAgeDays: 365,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) => db.journeyEvent.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take }),
        (ids) => db.journeyEvent.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
  {
    id: "journey-enrollments",
    subject: "Finished automated-message sequences (address, phone and context removed)",
    action: "anonymise",
    maxAgeDays: 365,
    run: async (cutoff, limit) => {
      const rows = await db.journeyEnrollment.findMany({
        where: {
          status: { in: ["COMPLETED", "CANCELLED"] },
          updatedAt: { lt: cutoff },
          OR: [{ email: { not: null } }, { phone: { not: null } }, { NOT: { context: "{}" } }],
        },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      return (
        await db.journeyEnrollment.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { email: null, phone: null, context: "{}" },
        })
      ).count;
    },
  },
  {
    id: "campaign-deliveries",
    subject: "Campaign delivery logs (the address is replaced; the sent count is kept)",
    action: "anonymise",
    maxAgeDays: 365,
    run: async (cutoff, limit) => {
      const rows = await db.campaignDelivery.findMany({
        where: { createdAt: { lt: cutoff }, NOT: { recipient: { startsWith: "erased:" } } },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      const ids = rows.map((row) => row.id);
      // recipient is part of a unique key with the campaign, so each row gets
      // a value of its own rather than one shared placeholder.
      return db.$executeRaw`
        UPDATE "CampaignDelivery" SET recipient = 'erased:' || id, error = NULL WHERE id = ANY(${ids}::text[])
      `;
    },
  },
  {
    id: "cart-abandonment",
    subject: "Abandoned-cart records",
    action: "delete",
    maxAgeDays: 395,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) => db.cartAbandonmentEvent.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take }),
        (ids) => db.cartAbandonmentEvent.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
  {
    id: "product-views",
    subject: "Product-view signals (random browser id, no identity)",
    action: "delete",
    maxAgeDays: 395,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) => db.productViewEvent.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take }),
        (ids) => db.productViewEvent.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
  {
    id: "contact-enquiries",
    subject: "Contact enquiries (name, email, phone and message removed)",
    action: "anonymise",
    maxAgeDays: 730,
    run: async (cutoff, limit) => {
      const rows = await db.contactEnquiry.findMany({
        where: { updatedAt: { lt: cutoff }, NOT: { email: { startsWith: "erased+" } } },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      const ids = rows.map((row) => row.id);
      return db.$executeRaw`
        UPDATE "ContactEnquiry"
        SET name = 'Erased', email = 'erased+' || id || '@invalid', phone = NULL, organization = NULL,
            message = '[erased]', "utmSource" = NULL, "utmMedium" = NULL, "utmCampaign" = NULL, referrer = NULL
        WHERE id = ANY(${ids}::text[])
      `;
    },
  },
  {
    id: "bulk-order-leads",
    subject: "Bulk and institutional enquiries (contact person, email, phone and notes removed)",
    action: "anonymise",
    maxAgeDays: 730,
    run: async (cutoff, limit) => {
      const rows = await db.bulkOrderLead.findMany({
        where: { updatedAt: { lt: cutoff }, NOT: { email: { startsWith: "erased+" } } },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      const ids = rows.map((row) => row.id);
      return db.$executeRaw`
        UPDATE "BulkOrderLead"
        SET organization = 'Erased', "contactPerson" = 'Erased', email = 'erased+' || id || '@invalid', phone = '',
            city = NULL, notes = NULL, "utmSource" = NULL, "utmMedium" = NULL, "utmCampaign" = NULL, referrer = NULL
        WHERE id = ANY(${ids}::text[])
      `;
    },
  },
  {
    id: "back-in-stock",
    subject: "Back-in-stock sign-ups once we have notified you",
    action: "delete",
    maxAgeDays: 180,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) =>
          db.backInStockSubscription.findMany({
            where: { notifiedAt: { not: null, lt: cutoff } },
            select: { id: true },
            take,
          }),
        (ids) => db.backInStockSubscription.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
  {
    id: "newsletter-unsubscribed",
    subject: "Newsletter sign-ups after you unsubscribe (the address is removed)",
    action: "anonymise",
    maxAgeDays: 365,
    run: async (cutoff, limit) => {
      const rows = await db.newsletterSubscriber.findMany({
        where: { unsubscribedAt: { lt: cutoff }, NOT: { email: { startsWith: "erased+" } } },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      const ids = rows.map((row) => row.id);
      return db.$executeRaw`
        UPDATE "NewsletterSubscriber" SET email = 'erased+' || id || '@invalid', "confirmToken" = NULL WHERE id = ANY(${ids}::text[])
      `;
    },
  },
  {
    id: "customer-tokens",
    subject: "Expired account verification and password-reset tokens",
    action: "delete",
    maxAgeDays: 30,
    inPolicy: false,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) => db.customerToken.findMany({ where: { expiresAt: { lt: cutoff } }, select: { id: true }, take }),
        (ids) => db.customerToken.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
  {
    id: "legacy-order-events",
    subject: "Legacy imported order events (email and phone removed)",
    action: "anonymise",
    maxAgeDays: 2192,
    run: async (cutoff, limit) => {
      const rows = await db.orderEvent.findMany({
        where: { createdAt: { lt: cutoff }, OR: [{ email: { not: null } }, { phone: { not: null } }, { metadata: { not: null } }] },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      return (
        await db.orderEvent.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { email: null, phone: null, metadata: null },
        })
      ).count;
    },
  },
  {
    id: "orders",
    subject: "Orders and invoices (kept in full for tax law; afterwards name, email, phone and street address are removed — the totals stay)",
    action: "anonymise",
    maxAgeDays: 2192,
    run: async (cutoff, limit) => {
      const rows = await db.order.findMany({
        where: { createdAt: { lt: cutoff }, NOT: { email: ERASED_EMAIL } },
        select: { id: true },
        take: limit,
      });
      return anonymiseOrdersById(
        db,
        rows.map((row) => row.id),
      );
    },
  },
  {
    id: "discount-redemptions",
    subject: "Discount-code redemptions (the address is removed with the order's)",
    action: "anonymise",
    maxAgeDays: 2192,
    run: async (cutoff, limit) => {
      const rows = await db.discountRedemption.findMany({
        where: { createdAt: { lt: cutoff }, NOT: { email: ERASED_EMAIL } },
        select: { id: true },
        take: limit,
      });
      if (rows.length === 0) return 0;
      return (
        await db.discountRedemption.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { email: ERASED_EMAIL, customerId: null },
        })
      ).count;
    },
  },
  {
    id: "audit-log",
    subject: "Staff activity logs (which team member changed what, and from which network address)",
    action: "delete",
    maxAgeDays: 1095,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) => db.auditLog.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take }),
        (ids) => db.auditLog.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
  {
    id: "cron-runs",
    subject: "Scheduled-job bookkeeping (no personal data)",
    action: "delete",
    maxAgeDays: 30,
    inPolicy: false,
    run: (cutoff, limit) =>
      deleteInBatch(
        (take) => db.cronRun.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take }),
        (ids) => db.cronRun.deleteMany({ where: { id: { in: ids } } }),
        limit,
      ),
  },
];

export interface RetentionRuleResult {
  id: string;
  action: RetentionRule["action"];
  handled: number;
  /** True when the run stopped on its time budget with rows still due — the
   * next daily run continues. */
  more: boolean;
  /** Set when this rule failed (the rest still ran). */
  error?: string;
}

export interface RetentionRunResult {
  rules: RetentionRuleResult[];
  totalHandled: number;
  elapsedMs: number;
}

export interface RetentionRunOptions {
  now?: Date;
  /** Rows handled per database round trip. */
  batchSize?: number;
  /** Stop starting new batches after this long (the function has a hard timeout). */
  budgetMs?: number;
  /** Limit the run to some rules (tests). Defaults to all of RETENTION_RULES. */
  rules?: readonly RetentionRule[];
}

/** Runs every rule oldest-first in bounded batches until none has anything
 * left, or the time budget is spent. Safe to run twice at once and safe to
 * re-run: each batch only matches rows not already handled. */
export async function runRetention(options: RetentionRunOptions = {}): Promise<RetentionRunResult> {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? 500;
  const budgetMs = options.budgetMs ?? 45_000;
  const rules = options.rules ?? RETENTION_RULES;
  const startedAt = Date.now();

  const results: RetentionRuleResult[] = [];
  let firstError: unknown;
  for (const rule of rules) {
    const cutoff = new Date(now.getTime() - rule.maxAgeDays * DAY_MS);
    let handled = 0;
    let more = false;
    let error: string | undefined;
    try {
      for (;;) {
        if (Date.now() - startedAt > budgetMs) {
          more = true;
          break;
        }
        const batch = await rule.run(cutoff, batchSize);
        handled += batch;
        if (batch < batchSize) break;
      }
    } catch (caught) {
      // One failing rule (a locked table, a constraint) must not stop the
      // others — the failure is reported and the rule retries tomorrow.
      error = caught instanceof Error ? caught.message : String(caught);
      firstError ??= caught;
    }
    results.push({ id: rule.id, action: rule.action, handled, more, ...(error ? { error } : {}) });
  }

  // Everything failed (the database is down): surface it, so the cron answers
  // 500, releases its day's claim and the platform's retry does the work.
  if (rules.length > 0 && results.every((result) => result.error)) throw firstError;

  return {
    rules: results,
    totalHandled: results.reduce((sum, result) => sum + result.handled, 0),
    elapsedMs: Date.now() - startedAt,
  };
}

/** "90 days", "12 months", "2 years" — for the privacy policy. */
export function formatRetentionPeriod(days: number): string {
  if (days < 120) return `${days} days`;
  const years = Math.round(days / 365);
  if (years >= 2 && Math.abs(days - years * 365) <= 3) return `${years} years`;
  return `${Math.round(days / 30.4)} months`;
}
