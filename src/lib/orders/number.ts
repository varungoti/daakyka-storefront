import { randomInt } from "node:crypto";

/**
 * Phase D3: order number generation. Phase G hardening (fixes finding F2,
 * see docs/audit-2026-09-19/security.md) widened the random suffix from 6
 * digits to 10 and switched from `Math.random()` (not cryptographically
 * random, and only 1,000,000 possible values per year) to
 * `crypto.randomInt`.
 *
 * Format is `DK-{YYYY}-{10 digits}`, e.g. `DK-2026-0048213567` — a plain
 * digit string stays quotable over the phone or WhatsApp for support
 * (the same shape as reading out a 10-digit mobile number), while the
 * 10-billion-value-per-year keyspace makes guessing/enumeration
 * impractical even without the page-level rate limit added alongside this
 * fix (src/app/order/[number]/page.tsx) as a second, independent layer.
 *
 * Uniqueness is still enforced by the DB (`Order.number @unique`) — this
 * module only produces candidates; src/lib/orders/create-order.ts retries
 * with a fresh candidate on a unique-constraint collision (Prisma error
 * code P2002), which is a simpler and race-free alternative to checking
 * existence first and inserting second. With this much larger keyspace a
 * collision is astronomically less likely than it already was, so the
 * retry design didn't need to change, only the candidate generator.
 */

const ORDER_NUMBER_SUFFIX_DIGITS = 10;
const ORDER_NUMBER_SUFFIX_SPACE = 10 ** ORDER_NUMBER_SUFFIX_DIGITS; // 10,000,000,000 values/year

const ORDER_NUMBER_PATTERN = /^DK-\d{4}-\d{10}$/;

/** Retries a fresh order-number candidate on collision this many times
 * before giving up (see createOrderFromCart). */
export const MAX_ORDER_NUMBER_ATTEMPTS = 8;

export function isValidOrderNumberFormat(value: string): boolean {
  return ORDER_NUMBER_PATTERN.test(value);
}

export function generateOrderNumberCandidate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const suffix = String(randomInt(ORDER_NUMBER_SUFFIX_SPACE)).padStart(ORDER_NUMBER_SUFFIX_DIGITS, "0");
  return `DK-${year}-${suffix}`;
}

export class OrderNumberGenerationError extends Error {
  constructor() {
    super(`Could not generate a unique order number after ${MAX_ORDER_NUMBER_ATTEMPTS} attempts`);
    this.name = "OrderNumberGenerationError";
  }
}
