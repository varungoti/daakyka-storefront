import type { Customer } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/** After this many failed attempts inside the rolling window, the account
 * locks for LOCK_DURATION_MS. */
export const MAX_FAILED_ATTEMPTS = 10;
/** Failures older than this don't count toward the threshold. */
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

export interface LockoutState {
  locked: boolean;
  lockedUntil: Date | null;
}

/** True while `lockedUntil` is set and still in the future. */
export function isLocked(customer: Pick<Customer, "lockedUntil">): boolean {
  return Boolean(customer.lockedUntil && customer.lockedUntil.getTime() > Date.now());
}

/**
 * Records a failed login attempt and locks the account when the threshold
 * is crossed within the rolling window.
 *
 * `failedLoginCount` has no per-attempt timestamps, only a single
 * `lastFailedLoginAt` marking the most recent one. We approximate "N
 * failures within 15 minutes" by resetting the counter to 1 whenever the
 * previous failure is older than the window, instead of tracking every
 * attempt's timestamp — a customer who fails once, waits 20 minutes, and
 * fails again starts a fresh count rather than accumulating toward the
 * lock. This is a deliberate simplification (documented in the D1 report)
 * rather than a full sliding-window log.
 */
export async function recordFailedLogin(customerId: string): Promise<LockoutState> {
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { failedLoginCount: true, lastFailedLoginAt: true },
  });
  if (!customer) return { locked: false, lockedUntil: null };

  const now = new Date();
  const withinWindow =
    customer.lastFailedLoginAt !== null &&
    now.getTime() - customer.lastFailedLoginAt.getTime() < FAILURE_WINDOW_MS;

  const nextCount = (withinWindow ? customer.failedLoginCount : 0) + 1;
  const shouldLock = nextCount >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = shouldLock ? new Date(now.getTime() + LOCK_DURATION_MS) : null;

  await db.customer.update({
    where: { id: customerId },
    data: {
      failedLoginCount: shouldLock ? 0 : nextCount,
      lastFailedLoginAt: now,
      lockedUntil,
    },
  });

  return { locked: shouldLock, lockedUntil };
}

export async function resetLoginFailures(customerId: string): Promise<void> {
  await db.customer.update({
    where: { id: customerId },
    data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
  });
}
