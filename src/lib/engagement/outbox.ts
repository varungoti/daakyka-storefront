import { db } from "@/lib/db";
import { sendEmail, type SendEmailInput, type SendEmailResult } from "@/lib/engagement/providers/email";

/**
 * F7 fix (docs/audit-2026-09-19/correctness.md): a durable outbox for
 * TRANSACTIONAL email only — order confirmations, account verify/reset
 * links, and anything else notify.ts/mailer.ts-style callers send directly
 * via providers/email.ts's sendEmail(). Marketing email (campaigns,
 * journeys) must never go through here: sendMarketingEmail() already has
 * its own consent (NewsletterSubscriber.unsubscribedAt) and
 * List-Unsubscribe-header guarantees, and replaying a queued send later
 * without re-checking consent at send time would quietly undermine those.
 * See src/lib/engagement/send-marketing-email.ts's own header comment.
 *
 * The flow:
 *   1. Every transactional call site (src/lib/orders/notify.ts,
 *      src/lib/customer-auth/mailer.ts) calls sendTransactionalEmail()
 *      instead of sendEmail() directly. It attempts the real send and
 *      always persists the outcome — SENT on success, PENDING on any
 *      failure — so nothing is ever only a console.log.
 *   2. The drain-email-outbox cron (src/app/api/cron/drain-email-outbox/
 *      route.ts) periodically calls drainEmailOutbox() to retry PENDING
 *      rows once a real provider is actually reachable.
 *   3. getUndeliveredEmailCount()/listRecentEmailOutboxForAdmin() back the
 *      admin-visible indicator (dashboard, orders list, /admin/notifications).
 */

export const EMAIL_KIND = {
  ORDER_CONFIRMATION_CUSTOMER: "order_confirmation_customer",
  ORDER_CONFIRMATION_ADMIN: "order_confirmation_admin",
  CUSTOMER_VERIFY_EMAIL: "customer_verify_email",
  CUSTOMER_RESET_PASSWORD: "customer_reset_password",
} as const;

export type EmailKind = (typeof EMAIL_KIND)[keyof typeof EMAIL_KIND];

/** After this many real attempts against an actually-configured provider
 * still fail, the row is terminal (FAILED) rather than retried forever —
 * protects against a permanently-bad address. A provider that was simply
 * never configured (result.provider === "stub") never counts toward this;
 * see sendTransactionalEmail() and drainEmailOutbox() below. */
export const MAX_ATTEMPTS = 6;

const BASE_BACKOFF_MS = 10 * 60 * 1000; // 10 minutes
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Exponential backoff, doubling from BASE_BACKOFF_MS and capped at
 * MAX_BACKOFF_MS: 10m, 20m, 40m, 1h20m, 2h40m, 5h20m for attempts 1..6
 * (MAX_ATTEMPTS) — the cap itself is only reached at attempt 7+, kept as a
 * safety ceiling in case MAX_ATTEMPTS ever grows. Roughly half a day of
 * retrying a real per-message failure before MAX_ATTEMPTS gives up on it. */
export function computeBackoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
}

const DEFAULT_BATCH_SIZE = 50;
// Same stale-claim pattern/timeout as JourneyEnrollment.lockedAt (see
// src/lib/engagement/journey-engine.ts) — a crashed run's lock shouldn't
// wedge a row forever.
const STALE_LOCK_AFTER_MS = 10 * 60 * 1000;

function parseHeaders(headers: string | null): Record<string, string> | undefined {
  if (!headers) return undefined;
  try {
    return JSON.parse(headers) as Record<string, string>;
  } catch {
    return undefined;
  }
}

export type SendTransactionalEmailResult = SendEmailResult & { outboxId: string | null };

/**
 * The ONLY path transactional callers (order notify, customer-auth mailer,
 * etc.) should use instead of calling providers/email.ts's sendEmail()
 * directly — see this module's header comment. Never throws: a DB hiccup
 * while persisting the outbox row is logged and swallowed, same
 * best-effort contract every existing caller already relies on.
 */
export async function sendTransactionalEmail(
  input: SendEmailInput,
  kind: EmailKind | string,
): Promise<SendTransactionalEmailResult> {
  let result: SendEmailResult;
  try {
    result = await sendEmail(input);
  } catch (error) {
    result = {
      ok: false,
      provider: "brevo",
      error: error instanceof Error ? error.message : "Email send failed",
    };
  }

  const headersJson = input.headers ? JSON.stringify(input.headers) : null;
  const baseData = {
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text ?? null,
    headers: headersJson,
    kind,
  };

  try {
    if (result.ok) {
      const row = await db.emailOutbox.create({
        data: {
          ...baseData,
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: result.messageId ?? null,
        },
      });
      return { ...result, outboxId: row.id };
    }

    // Not ok. provider:"stub" means Brevo simply isn't configured — that's
    // not a real attempt against a live provider, so it doesn't consume
    // any of the retry budget and gets no backoff: it's immediately
    // eligible the moment drainEmailOutbox next runs with Brevo configured.
    const isRealAttempt = result.provider === "brevo";
    const row = await db.emailOutbox.create({
      data: {
        ...baseData,
        status: "PENDING",
        attemptCount: isRealAttempt ? 1 : 0,
        lastError: result.error ?? null,
        nextAttemptAt: isRealAttempt ? new Date(Date.now() + computeBackoffMs(1)) : null,
      },
    });
    return { ...result, outboxId: row.id };
  } catch (dbError) {
    console.error("[engagement/outbox] failed to persist EmailOutbox row for", kind, dbError);
    return { ...result, outboxId: null };
  }
}

async function claimOutboxRow(id: string, now: Date, staleBefore: Date): Promise<boolean> {
  const result = await db.emailOutbox.updateMany({
    where: {
      id,
      status: "PENDING",
      OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
    },
    data: { lockedAt: now },
  });
  return result.count === 1;
}

export interface DrainEmailOutboxOptions {
  /** Injectable for tests so they can simulate "a provider is available"
   * (or a specific per-message failure) without ever calling real Brevo.
   * Production (the cron route) never passes this — it always uses the
   * real sendEmail(). */
  sendFn?: (input: SendEmailInput) => Promise<SendEmailResult>;
  now?: Date;
  batchSize?: number;
  /** Scope the batch to exactly these row ids instead of "oldest N PENDING
   * rows globally". The cron route never passes this (it should always
   * drain the real queue); tests do, so a run driven by an injected fake
   * sendFn can't reach into unrelated PENDING rows another, concurrently
   * running test file/process created against this same shared database —
   * see src/lib/engagement/outbox.test.ts. */
  ids?: string[];
}

export interface DrainEmailOutboxResult {
  /** Rows actually claimed and sent to sendFn this run. */
  attempted: number;
  sent: number;
  /** Rows that just crossed MAX_ATTEMPTS and were marked FAILED (terminal). */
  failedTerminal: number;
  /** PENDING rows left in the table after this run (not necessarily all
   * due — includes ones still backing off). */
  stillPending: number;
  /** Set when the run stopped early because the provider isn't actually
   * configured (every candidate would get the identical "stub" outcome
   * right now) — distinguishes "nothing to do yet" from "drained the
   * queue". */
  skippedReason?: "provider_not_configured";
}

/**
 * Retries PENDING EmailOutbox rows whose backoff has elapsed. Gated
 * two ways against double-sending: claimCronRun in the route handler
 * guards a duplicate invocation of the same scheduled tick, and
 * claimOutboxRow here (mirroring journey-engine.ts's claimEnrollment)
 * atomically locks each row before sending so two overlapping runs can
 * never send the same message twice.
 *
 * Stops early the moment a send comes back provider:"stub" — Brevo isn't
 * configured, so every remaining candidate in the batch would get the
 * identical outcome right now; no point spending N DB writes (or N calls
 * to isIntegrationEnabled under the hood) to learn that N times.
 */
export async function drainEmailOutbox(
  options: DrainEmailOutboxOptions = {},
): Promise<DrainEmailOutboxResult> {
  const sendFn = options.sendFn ?? sendEmail;
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const staleBefore = new Date(now.getTime() - STALE_LOCK_AFTER_MS);

  const candidates = await db.emailOutbox.findMany({
    where: {
      status: "PENDING",
      ...(options.ids ? { id: { in: options.ids } } : {}),
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  let attempted = 0;
  let sent = 0;
  let failedTerminal = 0;
  let notConfigured = false;

  for (const row of candidates) {
    const claimed = await claimOutboxRow(row.id, now, staleBefore);
    if (!claimed) continue; // another run claimed it first

    attempted += 1;

    let result: SendEmailResult;
    try {
      result = await sendFn({
        to: row.to,
        subject: row.subject,
        html: row.html,
        text: row.text ?? undefined,
        headers: parseHeaders(row.headers),
      });
    } catch (error) {
      result = {
        ok: false,
        provider: "brevo",
        error: error instanceof Error ? error.message : "Email send failed",
      };
    }

    if (result.ok) {
      await db.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: "SENT",
          sentAt: now,
          providerMessageId: result.messageId ?? null,
          lastError: null,
          lockedAt: null,
        },
      });
      sent += 1;
      continue;
    }

    if (result.provider === "stub") {
      await db.emailOutbox.update({
        where: { id: row.id },
        data: { lastError: result.error ?? null, lockedAt: null },
      });
      notConfigured = true;
      break;
    }

    const attemptCount = row.attemptCount + 1;
    if (attemptCount >= MAX_ATTEMPTS) {
      await db.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          attemptCount,
          lastError: result.error ?? "Send failed",
          lockedAt: null,
        },
      });
      failedTerminal += 1;
    } else {
      await db.emailOutbox.update({
        where: { id: row.id },
        data: {
          attemptCount,
          lastError: result.error ?? "Send failed",
          nextAttemptAt: new Date(now.getTime() + computeBackoffMs(attemptCount)),
          lockedAt: null,
        },
      });
    }
  }

  // Scoped to the same `ids` filter as the candidate query when provided,
  // so a test's assertion reflects only the rows it created rather than
  // the whole (possibly concurrently-populated) table; production calls
  // (no `ids`) get the real overall queue depth.
  const stillPending = await db.emailOutbox.count({
    where: { status: "PENDING", ...(options.ids ? { id: { in: options.ids } } : {}) },
  });

  return {
    attempted,
    sent,
    failedTerminal,
    stillPending,
    ...(notConfigured ? { skippedReason: "provider_not_configured" as const } : {}),
  };
}

export interface UndeliveredEmailCount {
  pending: number;
  failed: number;
  total: number;
}

/** Backs the admin-visible indicator (dashboard banner, orders list
 * banner, /admin/notifications). Mirrors getUnreadNotificationCount()'s
 * defensive shape (src/lib/notifications.ts) — a DB hiccup here must never
 * break the admin shell that calls it on every page load. */
export async function getUndeliveredEmailCount(): Promise<UndeliveredEmailCount> {
  try {
    const [pending, failed] = await Promise.all([
      db.emailOutbox.count({ where: { status: "PENDING" } }),
      db.emailOutbox.count({ where: { status: "FAILED" } }),
    ]);
    return { pending, failed, total: pending + failed };
  } catch {
    return { pending: 0, failed: 0, total: 0 };
  }
}

export interface EmailOutboxAdminRow {
  id: string;
  to: string;
  subject: string;
  kind: string;
  status: "PENDING" | "SENT" | "FAILED";
  attemptCount: number;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

/** Recent rows for the /admin/notifications "Email Outbox" audit-trail
 * section — every send attempt (SENT included), newest first. */
export async function listRecentEmailOutboxForAdmin(limit = 20): Promise<EmailOutboxAdminRow[]> {
  return db.emailOutbox.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      to: true,
      subject: true,
      kind: true,
      status: true,
      attemptCount: true,
      lastError: true,
      createdAt: true,
      sentAt: true,
    },
  });
}
