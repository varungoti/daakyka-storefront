import { createHash, randomBytes } from "node:crypto";
import type { CustomerTokenType } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { safeEquals } from "@/lib/security/timing-safe-equal";

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

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
): Promise<void> {
  await db.customerToken.updateMany({
    where: { customerId, type, usedAt: null },
    data: { usedAt: new Date() },
  });
}
