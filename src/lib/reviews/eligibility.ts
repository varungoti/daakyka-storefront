/**
 * Phase D2: the {logged-in, email-verified} gate `POST /api/reviews`
 * applies before ever calling createReview(). Pulled out as a pure
 * function (no `cookies()`/DB access) specifically so it's unit-testable —
 * the route itself can't be exercised end-to-end for the 403 branch in
 * this test harness, since calling a route handler directly (outside a
 * real Next.js request) makes `cookies()` throw and `getCustomerSession()`
 * always resolve `null` (see tests/integration/customer-auth.test.ts's
 * doc comment for the same limitation) — so a direct route call can only
 * ever reach the 401 branch here, never 403. The 403 branch is exercised
 * for real in the D2 runtime verification (register, leave unverified,
 * POST /api/reviews -> 403; verify; retry -> 201).
 */
export type ReviewSubmissionGateResult =
  | { ok: true }
  | { ok: false; status: 401; error: "Unauthorized" }
  | { ok: false; status: 403; error: "Please verify your email before writing a review" };

export function reviewSubmissionGate(
  session: { emailVerifiedAt: Date | null } | null,
): ReviewSubmissionGateResult {
  if (!session) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (!session.emailVerifiedAt) {
    return { ok: false, status: 403, error: "Please verify your email before writing a review" };
  }
  return { ok: true };
}
