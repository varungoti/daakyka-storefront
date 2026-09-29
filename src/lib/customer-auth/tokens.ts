import { createHash, randomBytes } from "node:crypto";
import { Prisma, type CustomerTokenType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { safeEquals } from "@/lib/security/timing-safe-equal";

// Exported so the email outbox (src/lib/engagement/outbox.ts, F-044) can
// stamp a matching per-kind EmailOutbox.expiresAt on a queued reset/verify
// email — a queued email must never outlive the token it links to.
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

/** Random, unguessable, URL-safe. 32 bytes of entropy is well beyond what's
 * brute-forceable, and base64url has no characters that need escaping in a
 * query string. */
export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/** We hash with SHA-256 (not bcrypt) because this is a high-entropy random
 * token, not a low-entropy human password — there's no offline-guessing
 * risk to slow down, and a fast hash keeps token lookups cheap. Only the
 * hash is ever persisted; the raw token exists only in the email link. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export interface IssuedToken {
  raw: string;
  expiresAt: Date;
}

/** Creates and persists a new VERIFY/RESET token for a customer, returning
 * the raw (unhashed) value to embed in the email link. */
export async function issueCustomerToken(
  customerId: string,
  type: CustomerTokenType,
): Promise<IssuedToken> {
  const raw = generateRawToken();
  const tokenHash = hashToken(raw);
  const ttl = type === "VERIFY" ? VERIFY_TOKEN_TTL_MS : RESET_TOKEN_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl);

  await db.customerToken.create({
    data: { customerId, type, tokenHash, expiresAt },
  });

  return { raw, expiresAt };
}

export type ConsumeTokenResult =
  | { ok: true; customerId: string; tokenId: string }
  | { ok: false; reason: "not_found" | "expired" | "used" };

/** Looks up a raw token by its hash, verifies it hasn't expired or already
 * been used, and — for the caller's convenience — does NOT mark it used;
 * call `markTokenUsed` once the caller has finished acting on it (so a
 * failure partway through the caller's own logic doesn't burn the token). */
export async function consumeCustomerToken(
  rawToken: string,
  type: CustomerTokenType,
): Promise<ConsumeTokenResult> {
  const tokenHash = hashToken(rawToken);

  // The hash is the unique lookup key (a 256-bit random value has no
  // meaningful timing side-channel via an indexed equality lookup), but we
  // still re-check it with a constant-time comparison as defense in depth
  // per the plan's requirement to compare token hashes with safeEquals.
  const record = await db.customerToken.findUnique({ where: { tokenHash } });
  if (!record || !safeEquals(record.tokenHash, tokenHash) || record.type !== type) {
    return { ok: false, reason: "not_found" };
  }
  if (record.usedAt) {
    return { ok: false, reason: "used" };
  }
  if (record.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, customerId: record.customerId, tokenId: record.id };
}

export async function markTokenUsed(tokenId: string): Promise<void> {
  await db.customerToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() },
  });
}

/**
 * F-133 fix: atomically claims a token that `consumeCustomerToken` already
 * pre-checked, so two concurrent requests presenting the same raw token
 * can't both succeed. `consumeCustomerToken` (above) is read-only — it does
 * a `findUnique` and returns `ok: true` without marking anything used,
 * which left a window between that read and the caller's later
 * `markTokenUsed` where several parallel requests could all pass the
 * check. This does the claim as a single conditional UPDATE ("use it only
 * if it's still unused and unexpired") and reports whether THIS call was
 * the one that won the race — run it inside the same transaction as the
 * password update so a losing claim can't proceed. Must always be called
 * inside a transaction: on failure the caller throws to roll the
 * transaction back rather than partially applying the password change.
 */
export async function claimCustomerToken(tx: Prisma.TransactionClient, tokenId: string): Promise<boolean> {
  const { count } = await tx.customerToken.updateMany({
    where: { id: tokenId, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

/**
 * Marks every currently-outstanding (unused — expired or not) token of
 * `type` for this customer as used, without ever being consumed through
 * consumeCustomerToken. Used before issuing a fresh token should supersede
 * any earlier one still sitting in an old email — e.g. resend-verification
 * (src/lib/customer-auth/resend-verification.ts) — so only the newest link
 * works and a stale/leaked earlier link stops being valid. Not called by
 * register/forgot-password today: only the flow that explicitly needs "one
 * live token at a time" opts into it, so those two keep their existing
 * (multiple-outstanding-tokens-allowed) behavior unchanged.
 */
export async function invalidateOutstandingTokens(
  customerId: string,
  type: CustomerTokenType,
  // F-133: optional so a caller that needs this to be part of a larger
  // db.$transaction (a reset or a password change revoking every other
  // outstanding RESET token atomically) can pass its `tx` client. Defaults
  // to the plain `db` client for existing standalone callers (e.g.
  // resend-verification.ts).
  client: Prisma.TransactionClient | typeof db = db,
): Promise<void> {
  await client.customerToken.updateMany({
    where: { customerId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
}
