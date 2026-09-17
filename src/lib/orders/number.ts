/**
 * Phase D3: order number generation. Format is `DK-{YYYY}-{6 random
 * digits}`, e.g. `DK-2026-004821`. Uniqueness is enforced by the DB
 * (`Order.number @unique`) — this module only produces candidates;
 * src/lib/orders/create-order.ts retries with a fresh candidate on a
 * unique-constraint collision (Prisma error code P2002), which is a
 * simpler and race-free alternative to checking existence first and
 * inserting second.
 */

const ORDER_NUMBER_PATTERN = /^DK-\d{4}-\d{6}$/;

/** Retries a fresh order-number candidate on collision this many times
 * before giving up (see createOrderFromCart). */
export const MAX_ORDER_NUMBER_ATTEMPTS = 8;

export function isValidOrderNumberFormat(value: string): boolean {
  return ORDER_NUMBER_PATTERN.test(value);
}

export function generateOrderNumberCandidate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return `DK-${year}-${suffix}`;
}

export class OrderNumberGenerationError extends Error {
  constructor() {
    super(`Could not generate a unique order number after ${MAX_ORDER_NUMBER_ATTEMPTS} attempts`);
    this.name = "OrderNumberGenerationError";
  }
}
