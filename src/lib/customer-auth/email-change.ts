import { createHmac, hkdfSync } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { sendEmailChangeEmail, sendEmailChangedNotice } from "@/lib/customer-auth/mailer";
import { invalidateOutstandingTokens } from "@/lib/customer-auth/tokens";
import { db } from "@/lib/db";
import { safeEquals } from "@/lib/security/timing-safe-equal";

/**
 * F-315: a shopper can correct the email on their own account — the one
 * thing the Profile tab did not let them edit. The change is only applied
 * after the NEW address proves it can receive mail:
 *
 *  1. requestEmailChange (needs the current password, checked by the route)
 *     emails a confirmation link to the new address and changes nothing yet.
 *  2. confirmEmailChange, reached by that link, swaps the address, marks it
 *     verified, signs the account out everywhere (sessionVersion) and revokes
 *     outstanding reset/verify links, then tells the OLD address.
 *
 * The link is a stateless HMAC-signed payload (customer id, the address it
 * was issued for, the address it moves to, an expiry) — there is nowhere to
 * store a "pending new email" without a schema change. Binding the *old*
 * address into it makes it single-use in effect: once applied, the account's
 * email no longer equals the payload's `from`, so a replay is refused (a
 * repeat of the very same change reports success instead of an error, so an
 * email scanner that pre-opened the link doesn't make the real click fail).
 * The key is derived from AUTH_SECRET with its own HKDF label, never
 * AUTH_SECRET itself (same approach as src/lib/orders/access-token.ts).
 */

export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

interface EmailChangePayload {
  /** customer id */
  c: string;
  /** address the account had when the link was issued */
  f: string;
  /** address it moves to */
  t: string;
  /** expiry, epoch ms */
  x: number;
}

function deriveKey(): Buffer {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) throw new Error("AUTH_SECRET environment variable is required");
  return Buffer.from(hkdfSync("sha256", authSecret, "", "daakyka:email-change:v1", 32));
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", deriveKey()).update(`email-change:v1:${encodedPayload}`).digest("base64url");
}

export function signEmailChangeToken(input: { customerId: string; fromEmail: string; toEmail: string; expiresAt: number }): string {
  const payload: EmailChangePayload = { c: input.customerId, f: input.fromEmail, t: input.toEmail, x: input.expiresAt };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/** The payload of a genuine, unexpired token — null for anything else
 * (tampered, malformed, expired, or AUTH_SECRET missing). */
export function readEmailChangeToken(token: string, now: number = Date.now()): EmailChangePayload | null {
  try {
    const [encoded, signature, ...rest] = token.split(".");
    if (!encoded || !signature || rest.length > 0) return null;
    if (!safeEquals(sign(encoded), signature)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<EmailChangePayload>;
    if (
      typeof payload.c !== "string" ||
      typeof payload.f !== "string" ||
      typeof payload.t !== "string" ||
      typeof payload.x !== "number" ||
      payload.x < now
    ) {
      return null;
    }
    return { c: payload.c, f: payload.f, t: payload.t, x: payload.x };
  } catch {
    return null;
  }
}

export type RequestEmailChangeResult = { ok: true } | { ok: false; reason: "same_email" };

/**
 * Sends the confirmation link to `newEmail`. An address that already belongs
 * to another account is answered exactly like a free one — nothing is sent,
 * but the caller sees the same success — so this cannot be used to probe
 * which addresses are registered.
 */
export async function requestEmailChange(
  customerId: string,
  newEmail: string,
  origin: string,
): Promise<RequestEmailChangeResult> {
  const to = newEmail.trim().toLowerCase();
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { email: true } });
  if (!customer) return { ok: true };
  if (customer.email.toLowerCase() === to) return { ok: false, reason: "same_email" };

  const taken = await db.customer.findUnique({ where: { email: to }, select: { id: true } });
  if (taken) return { ok: true };

  const token = signEmailChangeToken({
    customerId,
    fromEmail: customer.email,
    toEmail: to,
    expiresAt: Date.now() + EMAIL_CHANGE_TTL_MS,
  });
  await sendEmailChangeEmail(to, `${origin}/api/account/email/confirm?token=${encodeURIComponent(token)}`);
  return { ok: true };
}

export type ConfirmEmailChangeResult =
  | { ok: true; alreadyApplied: boolean }
  | { ok: false; error: string };

const INVALID_LINK = "This link is invalid or has expired. Request the change again from your profile.";

export async function confirmEmailChange(token: string): Promise<ConfirmEmailChangeResult> {
  const payload = readEmailChangeToken(token);
  if (!payload) return { ok: false, error: INVALID_LINK };

  const customer = await db.customer.findUnique({ where: { id: payload.c }, select: { id: true, email: true } });
  if (!customer) return { ok: false, error: INVALID_LINK };
  if (customer.email.toLowerCase() === payload.t) return { ok: true, alreadyApplied: true };
  if (customer.email.toLowerCase() !== payload.f) return { ok: false, error: INVALID_LINK };

  try {
    await db.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { email: payload.t, emailVerifiedAt: new Date(), sessionVersion: { increment: 1 } },
      });
      // Links issued for the old address must not outlive it.
      await invalidateOutstandingTokens(customer.id, "RESET", tx);
      await invalidateOutstandingTokens(customer.id, "VERIFY", tx);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "That email address is already used by another account." };
    }
    throw error;
  }

  await sendEmailChangedNotice(payload.f, payload.t);
  return { ok: true, alreadyApplied: false };
}
