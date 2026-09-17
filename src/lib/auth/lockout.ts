import type { User } from "@/generated/prisma/client";
import { db } from "@/lib/db";

/**
 * Admin account lockout (v1 2.2), mirroring
 * src/lib/customer-auth/lockout.ts's thresholds and logic exactly, applied
 * to the admin `User` model instead of `Customer`. This is deliberately a
 * near-identical copy rather than a shared generic helper: the two models
 * (`User`/`Customer`) aren't related by a common interface today, and
 * duplicating ~30 lines is a smaller risk than introducing a generic
 * abstraction across the admin/customer auth boundary the plan otherwise
 * keeps strictly separate (distinct cookies, distinct JWT audiences).
 *
 * Rate limiting (src/lib/security/rate-limit.ts) already throttles login
 * attempts per IP; this is a separate, per-account lockout so an attacker
 * spraying attempts across many IPs (or a botnet) still can't brute-force
 * one specific admin's password indefinitely.
 */

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
export function isLocked(user: Pick<User, "lockedUntil">): boolean {
  return Boolean(user.lockedUntil && user.lockedUntil.getTime() > Date.now());
}

/**
 * Records a failed login attempt and locks the account when the threshold
 * is crossed within the rolling window.
 *
 * `failedLoginCount` has no per-attempt timestamps, only a single
 * `lastFailedLoginAt` marking the most recent one. We approximate "N
 * failures within 15 minutes" by resetting the counter to 1 whenever the
 * previous failure is older than the window, instead of tracking every
 * attempt's timestamp — an admin who fails once, waits 20 minutes, and
 * fails again starts a fresh count rather than accumulating toward the
 * lock. This is the same deliberate simplification used for customers in
 * D1 (see src/lib/customer-auth/lockout.ts), kept consistent here.
 */
export async function recordFailedLogin(userId: string): Promise<LockoutState> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { failedLoginCount: true, lastFailedLoginAt: true },
  });
  if (!user) return { locked: false, lockedUntil: null };

  const now = new Date();
  const withinWindow =
    user.lastFailedLoginAt !== null &&
    now.getTime() - user.lastFailedLoginAt.getTime() < FAILURE_WINDOW_MS;

  const nextCount = (withinWindow ? user.failedLoginCount : 0) + 1;
  const shouldLock = nextCount >= MAX_FAILED_ATTEMPTS;
  const lockedUntil = shouldLock ? new Date(now.getTime() + LOCK_DURATION_MS) : null;

  await db.user.update({
    where: { id: userId },
    data: {
      failedLoginCount: shouldLock ? 0 : nextCount,
      lastFailedLoginAt: now,
      lockedUntil,
    },
  });

  return { locked: shouldLock, lockedUntil };
}

export async function resetLoginFailures(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null },
  });
}
