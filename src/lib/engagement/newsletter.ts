import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { EMAIL_KIND, sendTransactionalEmail } from "@/lib/engagement/outbox";
import { triggerJourneys } from "@/lib/engagement/journey-triggers";

/** Random, unguessable, URL-safe — same shape/entropy as
 * customer-auth/tokens.ts's generateRawToken, duplicated locally rather
 * than imported to keep the newsletter compliance flow independent of the
 * customer-auth module (different lifecycle, different table). */
function generateConfirmToken(): string {
  return randomBytes(24).toString("base64url");
}

function confirmUrlFor(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com").replace(/\/$/, "");
  return `${base}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;
}

/** Sends the double opt-in confirmation email through the transactional
 * outbox (F-264 fix) — never only a console.log. A stub/failed attempt is
 * persisted as a PENDING EmailOutbox row and retried by the drain-email-
 * outbox cron once Brevo is actually reachable, the same guarantee every
 * other transactional sender (order notify, customer-auth mailer) already
 * has; see src/lib/engagement/outbox.ts's header comment. Still logs a
 * "[dev]"-prefixed link on any non-ok result so the flow stays
 * testable/verifiable without Brevo configured — that's now a convenience
 * breadcrumb, not the only record of the send. Never throws.
 */
async function sendConfirmationEmail(email: string, token: string): Promise<void> {
  const confirmUrl = confirmUrlFor(token);

  try {
    const result = await sendTransactionalEmail(
      {
        to: email,
        subject: "Confirm your DAAKYKA Apparels newsletter subscription",
        html: `<p>Thanks for subscribing to DAAKYKA Apparels updates.</p><p><a href="${confirmUrl}">Confirm your subscription</a> to start receiving them.</p><p>If you didn't request this, you can ignore this email — you won't be subscribed unless you click the link.</p>`,
        text: `Confirm your subscription: ${confirmUrl}`,
      },
      EMAIL_KIND.NEWSLETTER_CONFIRM,
    );
    if (!result.ok) {
      console.log(`[dev] newsletter confirm link for ${email}: ${confirmUrl}`);
    }
  } catch (error) {
    console.log(`[dev] newsletter confirm link for ${email}: ${confirmUrl}`);
    console.warn("[newsletter] confirmation email send threw", error);
  }
}

export interface SubscribeInput {
  email: string;
  source?: string;
}

export interface SubscribeResult {
  id: string;
  /** True when this email was already confirmed before this call — no
   * confirmation email was (re)sent and nothing was (re)triggered. */
  alreadyConfirmed: boolean;
}

/**
 * Double opt-in subscribe: creates (or updates) a NewsletterSubscriber row
 * with `confirmedAt` still null and sends a confirmation email. Nothing is
 * enrolled in the welcome journey here — that only happens in
 * confirmNewsletterSubscriber(), once the link is actually clicked (see
 * that function for why).
 *
 * A resubscribe of an already-confirmed, non-unsubscribed email is a true
 * no-op (just refreshes `source`) — no new email, nothing re-triggered.
 *
 * F-050 fix: a resubscribe of a *previously-unsubscribed* email — confirmed
 * or not — is NOT reactivated here. An old confirmation only proves someone
 * once owned the address; it doesn't prove the current caller does, so
 * anyone who knew the address could otherwise undo the unsubscribe with no
 * consent check. Instead this issues a fresh confirmToken and (re)sends the
 * confirmation, exactly like a brand-new subscribe — `unsubscribedAt` stays
 * set until confirmNewsletterSubscriber actually clears it via that new
 * token.
 */
export async function subscribeToNewsletter(input: SubscribeInput): Promise<SubscribeResult> {
  const email = input.email.toLowerCase();
  const source = input.source ?? "footer";

  const existing = await db.newsletterSubscriber.findUnique({ where: { email } });

  if (existing?.confirmedAt && !existing.unsubscribedAt) {
    // Already an active, confirmed subscriber — refresh `source` only.
    // Never touch confirmedAt/unsubscribedAt/confirmToken on this path.
    await db.newsletterSubscriber.update({
      where: { id: existing.id },
      data: { source },
    });
    return { id: existing.id, alreadyConfirmed: true };
  }

  // Every other case — brand new, still-unconfirmed, or previously
  // unsubscribed — is treated as a fresh subscribe request: issue a new
  // confirmToken and send a confirmation. `unsubscribedAt` is deliberately
  // left as-is here; only a click on the new confirmation link clears it.
  const confirmToken = generateConfirmToken();
  const subscriber = existing
    ? await db.newsletterSubscriber.update({
        where: { id: existing.id },
        data: { source, consentGiven: true, confirmToken },
      })
    : await db.newsletterSubscriber.create({
        data: { email, source, consentGiven: true, confirmToken },
      });

  await sendConfirmationEmail(subscriber.email, confirmToken);

  return { id: subscriber.id, alreadyConfirmed: false };
}

export type ConfirmResult = { ok: true } | { ok: false; error: string };

/** Confirm tokens are random base64url from a 24-byte source (32 chars,
 * alphabet [A-Za-z0-9_-]) — this is just a cheap shape check before the DB
 * round trip, the unique-index lookup is the real check. */
function looksLikeConfirmToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(token);
}

/**
 * Shared by GET /api/newsletter/confirm (what the emailed link points at).
 * Sets `confirmedAt`, invalidates the single-use token, and — only for a
 * never-before-confirmed subscriber, never on raw subscribe — triggers the
 * "newsletter_signup" journey, so a welcome sequence never fires for an
 * address that hasn't actually confirmed it wants mail. Idempotent:
 * confirming an already-confirmed token (e.g. an email client prefetching
 * the link, or the link clicked twice) succeeds without re-triggering the
 * journey a second time.
 *
 * F-050 fix: also clears `unsubscribedAt` here — and only here — so a
 * resubscribe of a previously-unsubscribed address only reactivates it once
 * the fresh confirmation link `subscribeToNewsletter` issued is actually
 * clicked, never just by POSTing the address again.
 */
export async function confirmNewsletterSubscriber(token: string): Promise<ConfirmResult> {
  if (!looksLikeConfirmToken(token)) {
    return { ok: false, error: "Invalid or expired confirmation link" };
  }

  const subscriber = await db.newsletterSubscriber.findUnique({
    where: { confirmToken: token },
  });
  if (!subscriber) {
    return { ok: false, error: "Invalid or expired confirmation link" };
  }

  if (!subscriber.confirmedAt || subscriber.unsubscribedAt) {
    const neverConfirmedBefore = !subscriber.confirmedAt;
    await db.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { confirmedAt: new Date(), unsubscribedAt: null, confirmToken: null },
    });
    // Only enroll in the welcome series the first time an address is ever
    // confirmed — a resubscribe-after-unsubscribe must not replay it.
    if (neverConfirmedBefore) {
      await triggerJourneys("newsletter_signup", { email: subscriber.email });
    }
  }

  return { ok: true };
}
