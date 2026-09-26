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
 *
 * F-321: this used to be a `findUnique` followed by an `update` — two
 * round trips with a race between them. Concurrent requests (parallel
 * guesses from different IPs, which the per-account lockout exists
 * specifically to still catch once the per-IP rate limit is bypassed by
 * spreading attempts across IPs) all read the same pre-increment count and
 * each wrote back `count + 1`, so N simultaneous failures only ever
 * advanced the counter by 1 instead of N — and every one of those writes
 * that didn't itself cross the threshold wrote a literal `lockedUntil:
 * null`, silently erasing a lock a concurrent request had *just* set.
 * Mirrors the single atomic `UPDATE ... CASE ... RETURNING` pattern in
 * src/lib/security/rate-limit.ts's upsertBucket(): the whole
 * read-modify-write happens inside one statement, so Postgres serializes
 * concurrent updates to the same row instead of letting them interleave.
 * The CASE for `failedLoginCount`/`lockedUntil` is duplicated rather than
 * computed once, because a SET clause can only see the row's pre-update
 * (old) values — there's no way to reference "the failedLoginCount this
 * same statement is about to write" from another SET expression.
 */
export async function recordFailedLogin(customerId: string): Promise<LockoutState> {
  const rows = await db.$queryRaw<Array<{ failedLoginCount: number; lockedUntil: Date | null }>>`
    UPDATE "Customer" SET
      "failedLoginCount" = CASE
        WHEN "lastFailedLoginAt" IS NOT NULL
          AND "lastFailedLoginAt" > now() - (interval '1 millisecond' * ${FAILURE_WINDOW_MS})
        THEN "failedLoginCount" + 1
        ELSE 1
      END,
      "lastFailedLoginAt" = now(),
      "lockedUntil" = CASE
        WHEN (CASE
          WHEN "lastFailedLoginAt" IS NOT NULL
            AND "lastFailedLoginAt" > now() - (interval '1 millisecond' * ${FAILURE_WINDOW_MS})
          THEN "failedLoginCount" + 1
          ELSE 1
        END) >= ${MAX_FAILED_ATTEMPTS}
        THEN now() + (interval '1 millisecond' * ${LOCK_DURATION_MS})
        ELSE "lockedUntil"
      END
    WHERE id = ${customerId}
    RETURNING "failedLoginCount", "lockedUntil"
  `;

  const row = rows[0];
  if (!row) return { locked: false, lockedUntil: null };

  return {
    locked: row.lockedUntil !== null && row.lockedUntil.getTime() > Date.now(),
    lockedUntil: row.lockedUntil,
  };
}

/**
 * Thrown by resetLoginFailures() when 0 rows matched — i.e. the account is
 * locked as of that exact atomic check, even though the caller just
 * verified the password correctly. Exported (not just an internal detail)
 * so a caller that wants to answer with a clean 423 instead of falling
 * through to a generic error response can `catch` it specifically; until a
 * caller does that, letting it propagate is still safe — see the doc
 * comment on resetLoginFailures for why.
 */
export class AccountLockedError extends Error {
  constructor() {
    super("Account is locked; refusing to reset login failures.");
    this.name = "AccountLockedError";
  }
}

/**
 * Clears lockout state after a verified-correct password — but only if the
 * account isn't *currently* locked, checked atomically in the same
 * statement that clears it.
 *
 * F-321: both login routes (src/app/api/account/login/route.ts and
 * src/app/api/auth/login/route.ts) read the row and check `isLocked()`
 * *before* verifying the password, then call this function and proceed
 * straight to issuing a session — they don't (and, as files this package
 * doesn't own, currently can't be made to) branch on a return value from
 * here. Under concurrent requests, a failing sibling request can lock the
 * account in the gap between that early `isLocked()` read and this call:
 * bcrypt.compare on the correct password takes tens of milliseconds, long
 * enough for a parallel wrong-password request to land and lock the row.
 * A plain unconditional reset here would overwrite that lock and let the
 * legitimate-looking caller through with a session while the account was
 * supposed to be locked — reopening an account an attacker just got locked
 * out of. Guarding the UPDATE with `WHERE ... AND (not currently locked)`
 * makes "is it still safe to reset?" and the reset itself one atomic
 * operation instead of two, so it can never race — but a boolean return
 * the caller doesn't inspect wouldn't actually stop that session from
 * being issued. Throwing does: the route's outer `try/catch` turns this
 * into a 500 ("Login failed") instead of continuing on to
 * createSession()/createCustomerSession(), so no session is ever issued to
 * a request that hit this race, even without editing the route. The 500 is
 * a coarser response than the 423 an ordinary locked attempt gets (that
 * still comes from the early `isLocked()` check, unaffected by this), but
 * only for this narrow concurrent-with-the-lock-write window; see
 * needs_other_files in this package's report for the small route-side
 * change that would turn it into a proper 423 by catching
 * AccountLockedError specifically.
 */
export async function resetLoginFailures(customerId: string): Promise<void> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "Customer" SET
      "failedLoginCount" = 0,
      "lastFailedLoginAt" = NULL,
      "lockedUntil" = NULL
    WHERE id = ${customerId}
      AND ("lockedUntil" IS NULL OR "lockedUntil" <= now())
    RETURNING id
  `;
  if (rows.length === 0) {
    throw new AccountLockedError();
  }
}
