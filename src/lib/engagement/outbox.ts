import { db } from "@/lib/db";
import { sendEmail, type SendEmailInput, type SendEmailResult } from "@/lib/engagement/providers/email";
import { RESET_TOKEN_TTL_MS, VERIFY_TOKEN_TTL_MS } from "@/lib/customer-auth/tokens";
import { openOutboxBody, REDACTED_BODY, sealOutboxBody } from "@/lib/engagement/outbox-seal";

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
  // F-067 fix: the payment-received email promises "we'll let you know as
  // soon as it ships" (src/lib/orders/notify.ts) — these are what actually
  // keeps that promise. Queued by notifyOrderStatusChange (notify.ts)
  // whenever updateOrderAdmin (src/lib/orders/admin-orders.ts) moves an
  // order into one of these states.
  ORDER_SHIPPED_CUSTOMER: "order_shipped_customer",
  ORDER_CANCELLED_CUSTOMER: "order_cancelled_customer",
  ORDER_REFUNDED_CUSTOMER: "order_refunded_customer",
  CUSTOMER_VERIFY_EMAIL: "customer_verify_email",
  CUSTOMER_RESET_PASSWORD: "customer_reset_password",
  // F-315: the confirmation link sent to a NEW address when a shopper changes
  // their account email (src/lib/customer-auth/email-change.ts), and the
  // courtesy notice sent to the OLD address once the change has happened.
  CUSTOMER_EMAIL_CHANGE: "customer_email_change",
  CUSTOMER_EMAIL_CHANGED_NOTICE: "customer_email_changed_notice",
  // Shopify-parity gap: back-in-stock "Notify me" restock email — see
  // src/lib/back-in-stock/index.ts's sweepBackInStock.
  BACK_IN_STOCK: "back_in_stock",
  // F-264 fix: the newsletter double opt-in confirmation email (see
  // src/lib/engagement/newsletter.ts's sendConfirmationEmail) used to call
  // providers/email.ts's sendEmail() directly — a stub or failed send was
  // only ever console.logged, never retried, so a subscriber who signed up
  // while Brevo was off (or during a transient Brevo error) never got a
  // confirmation and stayed unconfirmed forever.
  NEWSLETTER_CONFIRM: "newsletter_confirm",
} as const;

export type EmailKind = (typeof EMAIL_KIND)[keyof typeof EMAIL_KIND];

/** F-044 fix: kinds where an older queued-but-unsent email must never go
 * out once a newer one for the same recipient exists — a reset or verify
 * link is only ever valid until the next one is issued (see
 * invalidateOutstandingTokens in src/lib/customer-auth/tokens.ts, which
 * does the equivalent for the CustomerToken row itself). Order
 * confirmations and back-in-stock notices are never "superseded" this
 * way — each is its own event, not a re-issue of the last one. */
const SUPERSEDING_KINDS: ReadonlySet<string> = new Set([
  EMAIL_KIND.CUSTOMER_VERIFY_EMAIL,
  EMAIL_KIND.CUSTOMER_RESET_PASSWORD,
  EMAIL_KIND.CUSTOMER_EMAIL_CHANGE,
  // F-264 fix: a resubscribe while still unconfirmed rotates confirmToken
  // (see subscribeToNewsletter in newsletter.ts) — same "only the newest
  // link works" rule as verify/reset, otherwise an earlier still-PENDING
  // confirmation could later go out carrying a dead token.
  EMAIL_KIND.NEWSLETTER_CONFIRM,
]);

/**
 * F-043: kinds whose body embeds a live credential — a raw reset / verify /
 * newsletter-confirm token, or the (non-expiring) order access link. The
 * customer-side tokens are hash-only in their own tables on purpose; the
 * outbox must not undo that. For these kinds the body is sealed
 * (outbox-seal.ts) while the row is PENDING and replaced by REDACTED_BODY
 * the moment it reaches any terminal state, so no readable credential is
 * ever kept at rest. Every other kind's body is kept as before (the data-
 * retention job, src/lib/privacy/retention.ts, ages those out).
 */
const CREDENTIAL_KINDS: ReadonlySet<string> = new Set([
  EMAIL_KIND.CUSTOMER_VERIFY_EMAIL,
  EMAIL_KIND.CUSTOMER_RESET_PASSWORD,
  EMAIL_KIND.CUSTOMER_EMAIL_CHANGE,
  EMAIL_KIND.NEWSLETTER_CONFIRM,
  EMAIL_KIND.ORDER_CONFIRMATION_CUSTOMER,
]);

export function isCredentialKind(kind: EmailKind | string): boolean {
  return CREDENTIAL_KINDS.has(kind);
}

/** The same set as an array, for queries (the retention job's sweep of rows
 * queued before sealing existed — src/lib/privacy/retention.ts). */
export const CREDENTIAL_EMAIL_KINDS: readonly string[] = [...CREDENTIAL_KINDS];

/** The `data` fragment that blanks a credential-bearing row's body — empty
 * for every other kind. */
function redactionFor(kind: EmailKind | string): { html?: string; text?: null } {
  return CREDENTIAL_KINDS.has(kind) ? { html: REDACTED_BODY, text: null } : {};
}

/** F-044 fix: how long a still-PENDING row of this kind stays eligible to
 * send. `null` = no expiry (order confirmations, back-in-stock) — those
 * keep today's behaviour of staying sendable indefinitely. Mirrors the
 * token TTLs a reset/verify email's own link is subject to — there's no
 * point delivering an email whose link has already died. */
function ttlMsForKind(kind: EmailKind | string): number | null {
  if (kind === EMAIL_KIND.CUSTOMER_RESET_PASSWORD) return RESET_TOKEN_TTL_MS;
  if (kind === EMAIL_KIND.CUSTOMER_VERIFY_EMAIL) return VERIFY_TOKEN_TTL_MS;
  if (kind === EMAIL_KIND.CUSTOMER_EMAIL_CHANGE) return VERIFY_TOKEN_TTL_MS;
  return null;
}

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

  // F-044 fix: a fresh reset/verify email supersedes any earlier one still
  // queued for the same recipient — mirrors invalidateOutstandingTokens'
  // "only the newest link works" rule on the CustomerToken side. Runs
  // whichever way this attempt itself landed (SENT or PENDING): even if
  // Brevo is configured and this send succeeds immediately, an
  // older PENDING row from before Brevo was configured must not go out
  // later carrying a dead link.
  if (SUPERSEDING_KINDS.has(kind)) {
    await db.emailOutbox
      .updateMany({
        where: { to: input.to, kind, status: "PENDING" },
        // F-043: a superseded reset/verify email is never sent, so its
        // (still-live) link has no reason to stay in the table.
        data: { status: "EXPIRED", ...redactionFor(kind) },
      })
      .catch((error) => {
        // Best-effort — never block the actual send/queue below over this.
        console.error("[engagement/outbox] failed to expire superseded rows for", kind, error);
      });
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
          // F-043: delivered — a credential-bearing body has no further use.
          ...redactionFor(kind),
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
    // F-044 fix: a time-sensitive row (reset/verify) must never be sent
    // once its own link has died, however long it sits PENDING — see
    // ttlMsForKind and drainEmailOutbox's expiry sweep below.
    const ttlMs = ttlMsForKind(kind);
    const row = await db.emailOutbox.create({
      data: {
        ...baseData,
        // F-043: waiting to be retried — a credential-bearing body is kept
        // sealed, never as readable HTML. Throws (and so persists nothing,
        // see the catch below) if AUTH_SECRET is missing: fail closed
        // rather than store a live link in the clear.
        ...(CREDENTIAL_KINDS.has(kind)
          ? { html: sealOutboxBody({ html: input.html, text: input.text ?? null }), text: null }
          : {}),
        status: "PENDING",
        expiresAt: ttlMs !== null ? new Date(Date.now() + ttlMs) : null,
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
  /** F-044 fix: PENDING rows whose expiresAt had already passed — never
   * claimed or sent this run, just marked EXPIRED. */
  expired: number;
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
  const idFilter = options.ids ? { id: { in: options.ids } } : {};

  // F-044 fix: flip any row whose per-kind TTL has already passed to
  // EXPIRED *before* selecting candidates below, so a dead reset/verify
  // link is never claimed and sent just because it happened to reach the
  // front of the queue. Rows with expiresAt: null (no TTL for this kind)
  // are untouched — same as before this column existed.
  const expiredResult = await db.emailOutbox.updateMany({
    where: { status: "PENDING", expiresAt: { lte: now }, ...idFilter },
    // F-043: an expired reset/verify link will never be sent — drop its body.
    data: { status: "EXPIRED", lockedAt: null, html: REDACTED_BODY, text: null },
  });

  const candidates = await db.emailOutbox.findMany({
    where: {
      status: "PENDING",
      ...idFilter,
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

    // F-043: a credential-bearing row's body is sealed at rest. One that
    // can't be opened (AUTH_SECRET changed since it was queued) can never be
    // sent — fail it (its link is at most a day old anyway) instead of
    // retrying forever.
    const body = openOutboxBody(row.html, row.text);
    if (!body) {
      await db.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          attemptCount: row.attemptCount + 1,
          lastError: "Stored body could not be decrypted (AUTH_SECRET changed since it was queued)",
          lockedAt: null,
          ...redactionFor(row.kind),
        },
      });
      failedTerminal += 1;
      continue;
    }

    let result: SendEmailResult;
    try {
      result = await sendFn({
        to: row.to,
        subject: row.subject,
        html: body.html,
        text: body.text ?? undefined,
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
          // F-043: delivered — see redactionFor.
          ...redactionFor(row.kind),
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
          ...redactionFor(row.kind),
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
    where: { status: "PENDING", ...idFilter },
  });

  return {
    attempted,
    sent,
    failedTerminal,
    expired: expiredResult.count,
    stillPending,
    ...(notConfigured ? { skippedReason: "provider_not_configured" as const } : {}),
  };
}

export interface UndeliveredEmailCount {
  pending: number;
  failed: number;
  total: number;
}

/** F-209: the emails an order's customer is waiting on — the confirmation
 * and the shipped / cancelled / refunded updates. Excludes the store's own
 * admin copy (ORDER_CONFIRMATION_ADMIN) and account emails (verify, reset),
 * so the orders-page banner counts only what is really about orders. */
export const CUSTOMER_ORDER_EMAIL_KINDS: readonly EmailKind[] = [
  EMAIL_KIND.ORDER_CONFIRMATION_CUSTOMER,
  EMAIL_KIND.ORDER_SHIPPED_CUSTOMER,
  EMAIL_KIND.ORDER_CANCELLED_CUSTOMER,
  EMAIL_KIND.ORDER_REFUNDED_CUSTOMER,
];

export interface UndeliveredEmailCountOptions {
  /** Count only these kinds. Omitted = every kind (the dashboard and
   * /admin/notifications show the whole queue). */
  kinds?: readonly string[];
}

/** Backs the admin-visible indicator (dashboard banner, orders list
 * banner, /admin/notifications). Mirrors getUnreadNotificationCount()'s
 * defensive shape (src/lib/notifications.ts) — a DB hiccup here must never
 * break the admin shell that calls it on every page load. */
export async function getUndeliveredEmailCount(
  options: UndeliveredEmailCountOptions = {},
): Promise<UndeliveredEmailCount> {
  try {
    const kindFilter = options.kinds ? { kind: { in: [...options.kinds] } } : {};
    const [pending, failed] = await Promise.all([
      db.emailOutbox.count({ where: { status: "PENDING", ...kindFilter } }),
      db.emailOutbox.count({ where: { status: "FAILED", ...kindFilter } }),
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
  // F-044 fix: EXPIRED added — a row the drain will now never send because
  // its per-kind TTL passed, or it was superseded by a newer reset/verify
  // email to the same recipient (see SUPERSEDING_KINDS above).
  status: "PENDING" | "SENT" | "FAILED" | "EXPIRED";
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
