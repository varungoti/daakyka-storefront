import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/customer-auth/password";
import { isLocked, recordFailedLogin } from "@/lib/customer-auth/lockout";
import { db } from "@/lib/db";
import { identityRateLimitOrResponse } from "@/lib/security/rate-limit";

/**
 * F-325: PATCH /api/account/profile's password-change branch used to
 * check `currentPassword` against the stored hash with no rate limit and
 * no lockout counting at all — 40 wrong guesses in 16 seconds, every one
 * a plain 400, `failedLoginCount`/`lockedUntil` never moving. That let
 * anyone holding a valid session (a copied cookie — see F-138) brute-force
 * the account's real password (useful elsewhere too) with none of the
 * protections a login attempt already gets.
 *
 * Split out of the route (mirroring src/lib/auth/user-admin.ts's own
 * doc comment on why service logic lives outside
 * src/app/api/**\/route.ts: it's directly unit/integration-testable
 * without needing a real Next.js request scope for `cookies()`) so this
 * can be exercised without a live session cookie. Reuses the exact same
 * rate limiter (`identityRateLimitOrResponse`, keyed on the customer's own
 * id — an already-authenticated caller doesn't need the IP+email shape
 * `account-login` uses) and the exact same `Customer.failedLoginCount` /
 * `lockedUntil` counters `recordFailedLogin`/`isLocked` maintain for
 * login, so a script hammering this endpoint locks the account exactly
 * as a script hammering /api/account/login would.
 */
export type VerifyCurrentPasswordResult =
  | { status: "ok" }
  | { status: "rate-limited"; response: NextResponse }
  | { status: "locked" }
  | { status: "incorrect" };

const LOCKED_MESSAGE = "Too many incorrect attempts. Try again later.";

export async function verifyCurrentPassword(
  request: Request,
  customerId: string,
  currentPassword: string,
): Promise<VerifyCurrentPasswordResult> {
  const limited = await identityRateLimitOrResponse(request, "account-password-change", 5, 60_000, {
    identity: customerId,
  });
  if (limited) return { status: "rate-limited", response: limited };

  const current = await db.customer.findUnique({
    where: { id: customerId },
    select: { passwordHash: true, lockedUntil: true },
  });

  if (current && isLocked(current)) {
    return { status: "locked" };
  }

  const valid = current && (await verifyPassword(currentPassword, current.passwordHash));
  if (!valid) {
    const { locked } = await recordFailedLogin(customerId);
    return { status: locked ? "locked" : "incorrect" };
  }

  return { status: "ok" };
}

/** Shared 423 body for both branches that report a lock — kept as one
 * exported constant so the route and this module never drift apart. */
export function lockedResponse(): NextResponse {
  return NextResponse.json({ error: LOCKED_MESSAGE }, { status: 423 });
}
