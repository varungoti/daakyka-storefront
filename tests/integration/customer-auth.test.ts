import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/customer-auth/password";
import { hashToken, invalidateOutstandingTokens, issueCustomerToken } from "@/lib/customer-auth/tokens";
import { updateCustomerProfile } from "@/lib/customer-auth/profile";
import { createAddressForCustomer, deleteAddressAndPromoteDefault, loadOwnAddress } from "@/lib/customer-auth/addresses";
import { AccountLockedError, recordFailedLogin, resetLoginFailures } from "@/lib/customer-auth/lockout";
import { verifyCurrentPassword } from "@/lib/customer-auth/verify-current-password";
import { revokeCustomerSessions, verifyCustomerSessionTokenResult } from "@/lib/customer-auth/session";
import { withEnv } from "../helpers/env";
import { SignJWT } from "jose";

import { POST as postRegister } from "@/app/api/account/register/route";
import { POST as postLogin } from "@/app/api/account/login/route";
import { GET as getVerifyEmail } from "@/app/api/account/verify-email/route";
import { POST as postForgotPassword } from "@/app/api/account/forgot-password/route";
import { POST as postResetPassword } from "@/app/api/account/reset-password/route";
import { POST as postResendVerification } from "@/app/api/account/resend-verification/route";
import { GET as getProfile, PATCH as patchProfile } from "@/app/api/account/profile/route";
import { GET as getAddresses, POST as postAddresses } from "@/app/api/account/addresses/route";
import { PATCH as patchAddress, DELETE as deleteAddress } from "@/app/api/account/addresses/[id]/route";
import { GET as getReviews } from "@/app/api/account/reviews/route";

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// F-138: mints a raw customer session JWT the same shape
// createCustomerSession() would sign, without going through cookies()
// (which throws outside a real Next.js request — see this file's harness
// note above). Mirrors src/lib/customer-auth/session.test.ts's identical
// helper.
async function signCustomerToken(customerId: string, sessionVersion: number): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is required");
  return new SignJWT({ sub: customerId, email: "customer@example.com", name: "Test Customer", sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("customer")
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(secret));
}

/**
 * Phase D1 customer accounts.
 *
 * IMPORTANT harness limitation (matches the existing admin auth tests —
 * see tests/integration/api-routes.test.ts's "POST /api/auth/login", which
 * only ever asserts the 401 path through a direct route call): calling a
 * route handler directly, outside a real Next.js request, means
 * `cookies()` throws (see src/lib/customer-auth/session.ts and
 * src/lib/auth/session.ts's identical comment) — so /register and /login's
 * success paths, which call createCustomerSession(), cannot return their
 * normal 201/200 here; the route's own try/catch turns that throw into a
 * 500. These tests therefore assert the underlying DB side effects (which
 * happen before the cookie write) rather than the HTTP status for those
 * two cases. The full cookie-based flow is exercised against a live
 * `npm run start` server in the D1 runtime verification step.
 */
/**
 * Every rate-limit key namespace this file writes to. The integration
 * suite runs ~36 files concurrently against one Postgres, so a reset has
 * to name the namespaces it owns rather than wiping the table — and the
 * after() sweep below has to cover exactly the same set, or the last
 * bucket each run touches survives into the next one. Keeping both on one
 * constant is what stops those two lists drifting apart.
 */
const ACCOUNT_RATE_LIMIT_PREFIXES = [
  "account-login",
  "account-register",
  "account-forgot-password",
  "account-reset-password",
  "account-resend-verification",
  "account-password-change",
] as const;

describe("customer accounts (Phase D1)", () => {
  const createdCustomerIds: string[] = [];

  after(async () => {
    await db.customerToken.deleteMany({ where: { customerId: { in: createdCustomerIds } } }).catch(() => {});
    await db.customerAddress.deleteMany({ where: { customerId: { in: createdCustomerIds } } }).catch(() => {});
    await db.review.deleteMany({ where: { customerId: { in: createdCustomerIds } } }).catch(() => {});
    await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
    await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
  });

  describe("POST /api/account/register", () => {
    it("creates an unverified customer and issues a VERIFY token, logging the dev fallback link", async () => {
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const unique = randomUUID().slice(0, 8);
      const email = `register-${unique}@example.com`;

      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      };
      let response: Response;
      try {
        response = await postRegister(
          jsonRequest("http://localhost/api/account/register", "POST", {
            name: "Test Customer",
            email,
            password: "password123",
            consentGiven: true,
          }),
        );
      } finally {
        console.log = originalLog;
      }

      const customer = await db.customer.findUnique({ where: { email } });
      assert.ok(customer, "customer row should exist");
      createdCustomerIds.push(customer!.id);
      assert.equal(customer!.emailVerifiedAt, null);
      assert.ok([201, 500].includes(response.status));

      const token = await db.customerToken.findFirst({
        where: { customerId: customer!.id, type: "VERIFY" },
      });
      assert.ok(token, "a VERIFY token should have been issued");
      assert.ok(
        logs.some((line) => line.includes("[dev] verification link")),
        "should log the dev fallback verification link since Brevo isn't configured in this test environment",
      );
    });

    it("returns a fake success and creates no customer when the honeypot is tripped", async () => {
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const unique = randomUUID().slice(0, 8);
      const email = `honeypot-${unique}@example.com`;
      const response = await postRegister(
        jsonRequest("http://localhost/api/account/register", "POST", {
          name: "Bot",
          email,
          password: "password123",
          consentGiven: true,
          company_website: "http://spam.example",
        }),
      );
      assert.equal(response.status, 201);
      const customer = await db.customer.findUnique({ where: { email } });
      assert.equal(customer, null);
    });

    it("rejects a duplicate email", async () => {
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const unique = randomUUID().slice(0, 8);
      const email = `dup-${unique}@example.com`;
      const customer = await db.customer.create({
        data: { email, name: "Existing", passwordHash: await hashPassword("password123") },
      });
      createdCustomerIds.push(customer.id);

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const response = await postRegister(
        jsonRequest("http://localhost/api/account/register", "POST", {
          name: "Duplicate",
          email,
          password: "password123",
          consentGiven: true,
        }),
      );
      assert.equal(response.status, 400);
    });
  });

  describe("POST /api/account/login", () => {
    it("returns 401 for an unknown email (timing-safe dummy compare path)", async () => {
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const response = await postLogin(
        jsonRequest("http://localhost/api/account/login", "POST", {
          email: `nope-${randomUUID().slice(0, 8)}@example.com`,
          password: "whatever123",
        }),
      );
      assert.equal(response.status, 401);
    });

    it("returns 401 for a known email with the wrong password", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `wrongpw-${unique}@example.com`;
      const customer = await db.customer.create({
        data: { email, name: "Wrong PW Test", passwordHash: await hashPassword("correct-password-1") },
      });
      createdCustomerIds.push(customer.id);

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const response = await postLogin(
        jsonRequest("http://localhost/api/account/login", "POST", {
          email,
          password: "not-the-right-password",
        }),
      );
      assert.equal(response.status, 401);
    });

    it("resets failedLoginCount/lockedUntil on a correct-password attempt (DB side effect happens before the cookie write throws in this harness)", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `resetcount-${unique}@example.com`;
      const customer = await db.customer.create({
        data: {
          email,
          name: "Reset Count Test",
          passwordHash: await hashPassword("correct-password-1"),
          failedLoginCount: 3,
          lastFailedLoginAt: new Date(),
        },
      });
      createdCustomerIds.push(customer.id);

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const response = await postLogin(
        jsonRequest("http://localhost/api/account/login", "POST", {
          email,
          password: "correct-password-1",
        }),
      );
      assert.ok([200, 500].includes(response.status));

      const updated = await db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updated!.failedLoginCount, 0);
      assert.equal(updated!.lockedUntil, null);
    });

    it("locks the account after 10 failed attempts within the window (returns 423)", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `lockout-${unique}@example.com`;
      const customer = await db.customer.create({
        data: { email, name: "Lockout Test", passwordHash: await hashPassword("correct-password-1") },
      });
      createdCustomerIds.push(customer.id);

      // Each iteration resets the in-memory rate-limit bucket first — this
      // test is specifically about the lockout counter on the Customer
      // row, not the separate per-IP rate limiter that would otherwise
      // return 429 well before the 10th attempt.
      for (let attempt = 1; attempt <= 9; attempt += 1) {
        await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
        const response = await postLogin(
          jsonRequest("http://localhost/api/account/login", "POST", {
            email,
            password: "wrong-password",
          }),
        );
        assert.equal(response.status, 401, `attempt ${attempt} should still be a plain 401`);
      }

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const lockedResponse = await postLogin(
        jsonRequest("http://localhost/api/account/login", "POST", {
          email,
          password: "wrong-password",
        }),
      );
      assert.equal(lockedResponse.status, 423, "the 10th failed attempt should lock the account");
      // F-137: the message must point the customer at a way back in
      // (reset the password, which also clears the lock) rather than
      // just "try again later" with no next step.
      const lockedBody = await lockedResponse.json();
      assert.match(lockedBody.error, /reset your password/i);

      const locked = await db.customer.findUnique({ where: { id: customer.id } });
      assert.ok(locked!.lockedUntil && locked!.lockedUntil.getTime() > Date.now());

      // Even the correct password is rejected while locked.
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const correctButLocked = await postLogin(
        jsonRequest("http://localhost/api/account/login", "POST", {
          email,
          password: "correct-password-1",
        }),
      );
      assert.equal(correctButLocked.status, 423);
    });

    // F-321: recordFailedLogin used to be a findUnique + update, so
    // concurrent failures raced each other — each read the same
    // pre-increment count, so N simultaneous failures only ever advanced
    // the counter by ~1, and every non-locking write stomped a
    // concurrently-set lockedUntil back to null (see
    // src/lib/customer-auth/lockout.ts's recordFailedLogin doc comment).
    // Reproduces evidence (2) from F-321 (t5c-lock-erasure): a
    // near-threshold count hit with several simultaneous wrong guesses.
    it("never leaves the account unlocked when concurrent failures cross the threshold at once (F-321)", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `race-lock-${unique}@example.com`;
      const customer = await db.customer.create({
        data: {
          email,
          name: "Race Lock Test",
          passwordHash: await hashPassword("correct-password-1"),
          // One failure below the lock threshold, recent enough to stay
          // inside the rolling window — the next failure(s) should lock it.
          failedLoginCount: 9,
          lastFailedLoginAt: new Date(),
        },
      });
      createdCustomerIds.push(customer.id);

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const concurrentAttempts = 8;
      const responses = await Promise.all(
        Array.from({ length: concurrentAttempts }, () =>
          postLogin(
            jsonRequest("http://localhost/api/account/login", "POST", {
              email,
              password: "wrong-password",
            }),
          ),
        ),
      );

      assert.ok(
        responses.some((response) => response.status === 423),
        `expected at least one 423 among concurrent responses, got ${responses.map((r) => r.status)}`,
      );

      const row = await db.customer.findUnique({ where: { id: customer.id } });
      assert.ok(
        row!.lockedUntil && row!.lockedUntil.getTime() > Date.now(),
        `account must be locked after crossing the threshold under concurrent failures, got lockedUntil=${row!.lockedUntil}`,
      );
      assert.ok(
        row!.failedLoginCount >= 10,
        `failedLoginCount must reflect every concurrent failure (>=10), got ${row!.failedLoginCount}`,
      );

      // A subsequent correct-password attempt must still be refused while
      // the race-set lock is in effect.
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const correctAfterRace = await postLogin(
        jsonRequest("http://localhost/api/account/login", "POST", {
          email,
          password: "correct-password-1",
        }),
      );
      assert.equal(correctAfterRace.status, 423);
    });

    // F-321: resetLoginFailures used to unconditionally clear lockout
    // state after a correct password, with no check that the account
    // hadn't been locked by a concurrent failure in the gap between the
    // route's early isLocked() read and this call (bcrypt.compare on the
    // correct password is slow enough to leave that gap wide open). Real
    // wall-clock concurrency through bcrypt is inherently racy — which
    // side wins depends on scheduling, not just on our fix — so this
    // asserts the one implication that must hold regardless of who wins:
    // with only `wrongAttempts` (< MAX_FAILED_ATTEMPTS) concurrent
    // failures racing the correct password, the account can only end up
    // locked if the atomic reset in resetLoginFailures lost the race and
    // threw (AccountLockedError) rather than clearing the lock — so a
    // locked-at-the-end row proves the correct-password request could not
    // have received a 200. See the deterministic, non-racy version of this
    // same guarantee just below, which forces the interesting ordering
    // directly instead of hoping bcrypt's scheduling cooperates.
    it("keeps the account locked (never issues a 200) when a correct password races concurrent lock-crossing failures (F-321)", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `race-success-${unique}@example.com`;
      const customer = await db.customer.create({
        data: {
          email,
          name: "Race Success Test",
          passwordHash: await hashPassword("correct-password-1"),
          // One failure below the lock threshold — a single concurrent
          // wrong-password attempt will cross it.
          failedLoginCount: 9,
          lastFailedLoginAt: new Date(),
        },
      });
      createdCustomerIds.push(customer.id);

      const wrongAttempts = 20;
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const [correctResponse, ...wrongResponses] = await Promise.all([
        postLogin(
          jsonRequest("http://localhost/api/account/login", "POST", {
            email,
            password: "correct-password-1",
          }),
        ),
        ...Array.from({ length: wrongAttempts }, () =>
          postLogin(
            jsonRequest("http://localhost/api/account/login", "POST", {
              email,
              password: "wrong-password",
            }),
          ),
        ),
      ]);

      assert.ok(
        wrongResponses.every((response) => response.status !== 200),
        "no wrong-password attempt should ever succeed",
      );

      const row = await db.customer.findUnique({ where: { id: customer.id } });
      const endedLocked = Boolean(row!.lockedUntil && row!.lockedUntil.getTime() > Date.now());
      if (endedLocked) {
        assert.notEqual(
          correctResponse.status,
          200,
          "the account ended up locked, so the racing correct-password request must not have been granted a session",
        );
      }
    });

    // Same guarantee as above, but with the interesting ordering forced
    // instead of left to bcrypt scheduling: lock the account first (an
    // awaited recordFailedLogin, standing in for "a concurrent failure
    // already landed"), then attempt the reset a correct password would
    // trigger next. This is what actually makes the HTTP-level test above
    // safe rather than merely lucky — it pins the exact behavior the fix
    // guarantees, deterministically, every run.
    it("resetLoginFailures refuses to clear a lock that was set after the caller's isLocked() read (F-321)", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `race-deterministic-${unique}@example.com`;
      const customer = await db.customer.create({
        data: {
          email,
          name: "Deterministic Race Test",
          passwordHash: await hashPassword("correct-password-1"),
          failedLoginCount: 9,
          lastFailedLoginAt: new Date(),
        },
      });
      createdCustomerIds.push(customer.id);

      // Simulates the route's early isLocked() read seeing an unlocked
      // account (true at this point), then bcrypt.compare taking long
      // enough for a concurrent wrong-password request to land and lock
      // it before this request reaches resetLoginFailures.
      const { locked } = await recordFailedLogin(customer.id);
      assert.equal(locked, true, "setup: the account should now be locked");

      await assert.rejects(
        () => resetLoginFailures(customer.id),
        AccountLockedError,
        "resetLoginFailures must refuse (throw) rather than silently clearing a lock set after the stale isLocked() read",
      );

      const row = await db.customer.findUnique({ where: { id: customer.id } });
      assert.ok(
        row!.lockedUntil && row!.lockedUntil.getTime() > Date.now(),
        "the lock must survive the failed reset attempt untouched",
      );
      assert.ok(row!.failedLoginCount >= 10);
    });

    // F-326: account-login is exactly the route the lockout above is meant
    // to backstop — a limiter DB outage must block (503), never silently
    // let the attempt through unthrottled.
    it("fails CLOSED (503) rather than allowing the attempt through when the rate limiter's DB is unreachable", async () => {
      await withEnv({ NODE_ENV: "production", DISABLE_RATE_LIMIT: undefined, VERCEL: "1" }, async () => {
        const original = db.$queryRaw;
        db.$queryRaw = (() => {
          throw new Error("simulated DB outage");
        }) as typeof db.$queryRaw;
        const originalError = console.error;
        console.error = () => {};

        try {
          const response = await postLogin(
            new Request("http://localhost/api/account/login", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-vercel-forwarded-for": "203.0.113.210" },
              body: JSON.stringify({ email: `failclosed-login-${randomUUID()}@example.com`, password: "whatever123" }),
            }),
          );
          assert.equal(response.status, 503, "a limiter DB outage must block login, not silently allow it");
          assert.ok(response.headers.get("Retry-After"));
        } finally {
          db.$queryRaw = original;
          console.error = originalError;
        }
      });
    });
  });

  describe("GET/POST /api/account/verify-email", () => {
    it("consumes a VERIFY token and sets emailVerifiedAt", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `verify-${unique}@example.com`, name: "Verify Test", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);
      const { raw } = await issueCustomerToken(customer.id, "VERIFY");

      const response = await getVerifyEmail(
        new Request(`http://localhost/api/account/verify-email?token=${raw}`),
      );
      assert.equal(response.status, 200);

      const updated = await db.customer.findUnique({ where: { id: customer.id } });
      assert.ok(updated!.emailVerifiedAt);

      const tokenRow = await db.customerToken.findFirst({
        where: { customerId: customer.id, type: "VERIFY" },
      });
      assert.ok(tokenRow!.usedAt, "token should be marked used after consumption");
    });

    it("rejects an invalid or unknown token", async () => {
      const response = await getVerifyEmail(
        new Request("http://localhost/api/account/verify-email?token=not-a-real-token"),
      );
      assert.equal(response.status, 400);
    });

    it("rejects a token that has already been consumed", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `verify-reuse-${unique}@example.com`, name: "Verify Reuse Test", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);
      const { raw } = await issueCustomerToken(customer.id, "VERIFY");

      const first = await getVerifyEmail(
        new Request(`http://localhost/api/account/verify-email?token=${raw}`),
      );
      assert.equal(first.status, 200);

      const second = await getVerifyEmail(
        new Request(`http://localhost/api/account/verify-email?token=${raw}`),
      );
      assert.equal(second.status, 400);
    });
  });

  describe("POST /api/account/forgot-password", () => {
    it("returns an identical generic response for an existing and a non-existing email", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `forgot-${unique}@example.com`;
      const customer = await db.customer.create({
        data: { email, name: "Forgot Test", passwordHash: await hashPassword("password123") },
      });
      createdCustomerIds.push(customer.id);

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const existingResponse = await postForgotPassword(
        jsonRequest("http://localhost/api/account/forgot-password", "POST", { email }),
      );
      const existingBody = await existingResponse.json();

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const missingResponse = await postForgotPassword(
        jsonRequest("http://localhost/api/account/forgot-password", "POST", {
          email: `nonexistent-${unique}@example.com`,
        }),
      );
      const missingBody = await missingResponse.json();

      assert.equal(existingResponse.status, missingResponse.status);
      assert.deepEqual(existingBody, missingBody);

      // But a RESET token was only actually issued for the real customer.
      const tokenCount = await db.customerToken.count({
        where: { customerId: customer.id, type: "RESET" },
      });
      assert.equal(tokenCount, 1);
    });

    // F-139: forgot-password used to be throttled only per IP (5/min), so
    // one IP — or several acting together — could flood a single victim's
    // inbox with reset emails. Mirrors resend-verification's own per-
    // account throttle test below. The response must stay the identical
    // GENERIC_RESPONSE even once the limit is hit — a distinct status or
    // body would itself leak that the account exists and is being
    // throttled.
    it("caps reset emails for one account regardless of how many requests it gets", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `forgot-throttle-${unique}@example.com`;
      const customer = await db.customer.create({
        data: { email, name: "Forgot Throttle Test", passwordHash: await hashPassword("password123") },
      });
      createdCustomerIds.push(customer.id);

      const bodies: unknown[] = [];
      const statuses: number[] = [];
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await postForgotPassword(
          jsonRequest("http://localhost/api/account/forgot-password", "POST", { email }),
        );
        statuses.push(response.status);
        bodies.push(await response.json());
      }

      assert.ok(statuses.every((status) => status === 200), `expected every response to be 200, got ${statuses}`);
      assert.ok(
        bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0])),
        "every response body must be identical, including once the per-account limit is hit",
      );

      const tokenCount = await db.customerToken.count({
        where: { customerId: customer.id, type: "RESET" },
      });
      assert.equal(tokenCount, 3, `expected only the first 3 requests to issue a token, got ${tokenCount}`);
    });
  });

  describe("invalidateOutstandingTokens (F3)", () => {
    it("marks every unused token of a given type used, leaving other types/customers untouched", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `invalidate-${unique}@example.com`, name: "Invalidate Test", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);

      const verifyOne = await issueCustomerToken(customer.id, "VERIFY");
      const verifyTwo = await issueCustomerToken(customer.id, "VERIFY");
      const reset = await issueCustomerToken(customer.id, "RESET");

      await invalidateOutstandingTokens(customer.id, "VERIFY");

      const tokens = await db.customerToken.findMany({ where: { customerId: customer.id } });
      const byHash = new Map(tokens.map((t) => [t.tokenHash, t]));

      assert.ok(byHash.get(hashToken(verifyOne.raw))?.usedAt, "first VERIFY token should now be used");
      assert.ok(byHash.get(hashToken(verifyTwo.raw))?.usedAt, "second VERIFY token should now be used");
      assert.equal(
        byHash.get(hashToken(reset.raw))?.usedAt,
        null,
        "a RESET token must be untouched by invalidating VERIFY tokens",
      );
    });
  });

  describe("POST /api/account/resend-verification (F3)", () => {
    it("returns an identical generic response for an unverified, an already-verified, and an unknown email", async () => {
      const unique = randomUUID().slice(0, 8);
      const unverifiedEmail = `resend-unverified-${unique}@example.com`;
      const verifiedEmail = `resend-verified-${unique}@example.com`;

      const unverified = await db.customer.create({
        data: { email: unverifiedEmail, name: "Unverified", passwordHash: "x" },
      });
      const verified = await db.customer.create({
        data: { email: verifiedEmail, name: "Verified", passwordHash: "x", emailVerifiedAt: new Date() },
      });
      createdCustomerIds.push(unverified.id, verified.id);

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const unverifiedResponse = await postResendVerification(
        jsonRequest("http://localhost/api/account/resend-verification", "POST", { email: unverifiedEmail }),
      );
      const unverifiedBody = await unverifiedResponse.json();

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const verifiedResponse = await postResendVerification(
        jsonRequest("http://localhost/api/account/resend-verification", "POST", { email: verifiedEmail }),
      );
      const verifiedBody = await verifiedResponse.json();

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const unknownResponse = await postResendVerification(
        jsonRequest("http://localhost/api/account/resend-verification", "POST", {
          email: `resend-unknown-${unique}@example.com`,
        }),
      );
      const unknownBody = await unknownResponse.json();

      assert.equal(unverifiedResponse.status, verifiedResponse.status);
      assert.equal(verifiedResponse.status, unknownResponse.status);
      assert.deepEqual(unverifiedBody, verifiedBody);
      assert.deepEqual(verifiedBody, unknownBody);

      // Only the genuinely-unverified customer actually got a new token.
      assert.equal(
        await db.customerToken.count({ where: { customerId: unverified.id, type: "VERIFY" } }),
        1,
      );
      assert.equal(
        await db.customerToken.count({ where: { customerId: verified.id, type: "VERIFY" } }),
        0,
      );
    });

    it("invalidates the previous outstanding VERIFY token before issuing a new one", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `resend-reissue-${unique}@example.com`;
      const customer = await db.customer.create({
        data: { email, name: "Reissue Test", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);

      const original = await issueCustomerToken(customer.id, "VERIFY");

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const response = await postResendVerification(
        jsonRequest("http://localhost/api/account/resend-verification", "POST", { email }),
      );
      assert.equal(response.status, 200);

      const originalRow = await db.customerToken.findUnique({
        where: { tokenHash: hashToken(original.raw) },
      });
      assert.ok(originalRow?.usedAt, "the original token should be invalidated by the resend");

      const liveTokens = await db.customerToken.findMany({
        where: { customerId: customer.id, type: "VERIFY", usedAt: null },
      });
      assert.equal(liveTokens.length, 1, "exactly one live VERIFY token should remain after a resend");
    });

    it("rate-limits repeated resends for the same account", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `resend-ratelimit-${unique}@example.com`;
      const customer = await db.customer.create({
        data: { email, name: "Rate Limit Test", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);

      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const statuses: number[] = [];
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const response = await postResendVerification(
          jsonRequest("http://localhost/api/account/resend-verification", "POST", { email }),
        );
        statuses.push(response.status);
      }

      assert.ok(statuses.slice(0, 3).every((status) => status === 200), `expected the first 3 to succeed, got ${statuses}`);
      assert.equal(statuses[3], 429, `expected the 4th resend for the same account to be rate-limited, got ${statuses}`);
    });
  });

  describe("POST /api/account/reset-password", () => {
    it("changes the password, consumes the token, and bumps sessionVersion (logs out other sessions)", async () => {
      const unique = randomUUID().slice(0, 8);
      const oldHash = await hashPassword("old-password-123");
      const customer = await db.customer.create({
        data: { email: `reset-${unique}@example.com`, name: "Reset Test", passwordHash: oldHash },
      });
      createdCustomerIds.push(customer.id);
      const originalVersion = customer.sessionVersion;
      const { raw } = await issueCustomerToken(customer.id, "RESET");

      const response = await postResetPassword(
        jsonRequest("http://localhost/api/account/reset-password", "POST", {
          token: raw,
          newPassword: "new-password-456",
        }),
      );
      assert.equal(response.status, 200);

      const updated = await db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updated!.sessionVersion, originalVersion + 1);
      assert.notEqual(updated!.passwordHash, oldHash);
      assert.equal(await verifyPassword("new-password-456", updated!.passwordHash), true);

      const tokenRow = await db.customerToken.findFirst({
        where: { customerId: customer.id, type: "RESET" },
      });
      assert.ok(tokenRow!.usedAt);
    });

    it("rejects reusing an already-consumed reset token", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: {
          email: `reset-reuse-${unique}@example.com`,
          name: "Reset Reuse Test",
          passwordHash: await hashPassword("old-password-123"),
        },
      });
      createdCustomerIds.push(customer.id);
      const { raw } = await issueCustomerToken(customer.id, "RESET");

      const first = await postResetPassword(
        jsonRequest("http://localhost/api/account/reset-password", "POST", {
          token: raw,
          newPassword: "new-password-456",
        }),
      );
      assert.equal(first.status, 200);

      const second = await postResetPassword(
        jsonRequest("http://localhost/api/account/reset-password", "POST", {
          token: raw,
          newPassword: "another-password-789",
        }),
      );
      assert.equal(second.status, 400);
    });

    // F-133: forgot-password deliberately allows several outstanding RESET
    // tokens at once (see tokens.ts's invalidateOutstandingTokens doc
    // comment), but a *successful* reset must revoke every other one —
    // otherwise an older reset link emailed earlier kept working after the
    // account's password had already changed.
    it("revokes every other outstanding RESET token once a reset succeeds", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: {
          email: `reset-revoke-${unique}@example.com`,
          name: "Reset Revoke Test",
          passwordHash: await hashPassword("old-password-123"),
        },
      });
      createdCustomerIds.push(customer.id);

      const first = await issueCustomerToken(customer.id, "RESET");
      const second = await issueCustomerToken(customer.id, "RESET");

      const firstResponse = await postResetPassword(
        jsonRequest("http://localhost/api/account/reset-password", "POST", {
          token: first.raw,
          newPassword: "new-password-456",
        }),
      );
      assert.equal(firstResponse.status, 200);

      const secondResponse = await postResetPassword(
        jsonRequest("http://localhost/api/account/reset-password", "POST", {
          token: second.raw,
          newPassword: "yet-another-password-789",
        }),
      );
      assert.equal(
        secondResponse.status,
        400,
        "a second outstanding reset link must stop working once an earlier one has succeeded",
      );

      const updated = await db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(
        await verifyPassword("new-password-456", updated!.passwordHash),
        true,
        "the password from the first (successful) reset must be the one that stuck",
      );
    });

    // F-133: consumeCustomerToken was a read-only pre-check, and the actual
    // claim (markTokenUsed) happened only after the password update — a
    // window where several concurrent requests presenting the SAME token
    // could all pass the check. claimCustomerToken's atomic
    // `updateMany({ usedAt: null, ... })` inside the transaction closes it.
    it("lets exactly one of several concurrent requests with the same token succeed", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: {
          email: `reset-race-${unique}@example.com`,
          name: "Reset Race Test",
          passwordHash: await hashPassword("old-password-123"),
        },
      });
      createdCustomerIds.push(customer.id);
      const { raw } = await issueCustomerToken(customer.id, "RESET");

      const responses = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          postResetPassword(
            jsonRequest("http://localhost/api/account/reset-password", "POST", {
              token: raw,
              newPassword: `concurrent-password-${i}`,
            }),
          ),
        ),
      );
      const statuses = responses.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === 200).length, 1, `expected exactly one 200, got ${statuses}`);
      assert.equal(statuses.filter((s) => s === 400).length, 4, `expected the other four to be 400, got ${statuses}`);

      const updated = await db.customer.findUnique({ where: { id: customer.id } });
      // sessionVersion must only have been bumped once — not once per
      // request that got past the old read-only pre-check.
      assert.equal(updated!.sessionVersion, customer.sessionVersion + 1);
    });
  });

  // F-133: PATCH /api/account/profile can't be called with a session cookie
  // from this harness (see the note at the top of this file), so the shared
  // logic it now delegates to is exercised directly.
  describe("updateCustomerProfile (F-133)", () => {
    it("revokes every outstanding RESET token when the password changes", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: {
          email: `profile-pw-${unique}@example.com`,
          name: "Profile Password Test",
          passwordHash: await hashPassword("old-password-123"),
        },
      });
      createdCustomerIds.push(customer.id);

      // An emailed reset link that is still unused when the customer changes
      // their password another way.
      const outstanding = await issueCustomerToken(customer.id, "RESET");

      await updateCustomerProfile(customer.id, { passwordHash: await hashPassword("new-password-456") });

      const resetResponse = await postResetPassword(
        jsonRequest("http://localhost/api/account/reset-password", "POST", {
          token: outstanding.raw,
          newPassword: "attacker-chosen-789",
        }),
      );
      assert.equal(resetResponse.status, 400, "a reset link issued before a password change must stop working");

      const updated = await db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(await verifyPassword("new-password-456", updated!.passwordHash), true);
      assert.equal(updated!.sessionVersion, customer.sessionVersion + 1);
    });

    it("leaves outstanding RESET tokens alone for a name/phone-only edit", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: {
          email: `profile-name-${unique}@example.com`,
          name: "Profile Name Test",
          passwordHash: await hashPassword("old-password-123"),
        },
      });
      createdCustomerIds.push(customer.id);
      const { raw } = await issueCustomerToken(customer.id, "RESET");

      const updated = await updateCustomerProfile(customer.id, { name: "Renamed Customer" });
      assert.equal(updated.name, "Renamed Customer");

      const token = await db.customerToken.findUnique({ where: { tokenHash: hashToken(raw) } });
      assert.equal(token?.usedAt, null, "a name-only edit must not burn the reset link");
      const after = await db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(after!.sessionVersion, customer.sessionVersion, "and must not log other sessions out");
    });
  });

  describe("address scoping (own customer only)", () => {
    it("loadOwnAddress returns the address for its owner and null for a different customer or unknown id", async () => {
      const unique = randomUUID().slice(0, 8);
      const customerA = await db.customer.create({
        data: { email: `addr-a-${unique}@example.com`, name: "Customer A", passwordHash: "x" },
      });
      const customerB = await db.customer.create({
        data: { email: `addr-b-${unique}@example.com`, name: "Customer B", passwordHash: "x" },
      });
      createdCustomerIds.push(customerA.id, customerB.id);

      const address = await db.customerAddress.create({
        data: {
          customerId: customerA.id,
          line1: "1 Test Street",
          city: "Hyderabad",
          state: "Telangana",
          postalCode: "500001",
        },
      });

      const ownResult = await loadOwnAddress(address.id, customerA.id);
      assert.ok(ownResult);
      assert.equal(ownResult!.id, address.id);

      const crossCustomerResult = await loadOwnAddress(address.id, customerB.id);
      assert.equal(
        crossCustomerResult,
        null,
        "a second customer must never be able to load the first customer's address",
      );

      const unknownIdResult = await loadOwnAddress("not-a-real-address-id", customerA.id);
      assert.equal(unknownIdResult, null);
    });

    // F-134: "Set as default address" used to only ever come true when the
    // shopper explicitly ticked it — a first-time saver's only address
    // stayed isDefault:false forever, so checkout had nothing to prefill
    // from even though there was exactly one obvious choice.
    it("createAddressForCustomer makes a customer's first address default automatically", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `addr-first-${unique}@example.com`, name: "Customer", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);

      const first = await createAddressForCustomer(customer.id, {
        line1: "1 First Street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500001",
      });
      assert.equal(first.isDefault, true, "the very first saved address must become default");

      const second = await createAddressForCustomer(customer.id, {
        line1: "2 Second Street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500002",
      });
      assert.equal(second.isDefault, false, "a second address must not become default unless requested");

      const refreshedFirst = await db.customerAddress.findUnique({ where: { id: first.id } });
      assert.equal(refreshedFirst?.isDefault, true, "the original default must be unaffected by adding a second address");
    });

    it("createAddressForCustomer clears the previous default when a new address explicitly asks to be default", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `addr-swap-${unique}@example.com`, name: "Customer", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);

      const first = await createAddressForCustomer(customer.id, {
        line1: "1 First Street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500001",
      });
      assert.equal(first.isDefault, true);

      const second = await createAddressForCustomer(customer.id, {
        line1: "2 Second Street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500002",
        isDefault: true,
      });
      assert.equal(second.isDefault, true);

      const refreshedFirst = await db.customerAddress.findUnique({ where: { id: first.id } });
      assert.equal(refreshedFirst?.isDefault, false, "only one address may be default at a time");
    });

    // F-134: deleting the default used to promote nothing, so "default
    // address" silently stopped meaning anything the moment it was removed.
    it("deleteAddressAndPromoteDefault promotes the oldest remaining address when the default is deleted", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `addr-promote-${unique}@example.com`, name: "Customer", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);

      const first = await createAddressForCustomer(customer.id, {
        line1: "1 First Street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500001",
      });
      const second = await createAddressForCustomer(customer.id, {
        line1: "2 Second Street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500002",
      });
      assert.equal(first.isDefault, true);

      await deleteAddressAndPromoteDefault(first.id, customer.id, true);

      const refreshedSecond = await db.customerAddress.findUnique({ where: { id: second.id } });
      assert.equal(refreshedSecond?.isDefault, true, "the oldest remaining address must be promoted");

      const deletedFirst = await db.customerAddress.findUnique({ where: { id: first.id } });
      assert.equal(deletedFirst, null);
    });

    it("deleteAddressAndPromoteDefault leaves the default untouched when a non-default address is deleted", async () => {
      const unique = randomUUID().slice(0, 8);
      const customer = await db.customer.create({
        data: { email: `addr-nondefault-${unique}@example.com`, name: "Customer", passwordHash: "x" },
      });
      createdCustomerIds.push(customer.id);

      const first = await createAddressForCustomer(customer.id, {
        line1: "1 First Street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500001",
      });
      const second = await createAddressForCustomer(customer.id, {
        line1: "2 Second Street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500002",
      });

      await deleteAddressAndPromoteDefault(second.id, customer.id, false);

      const refreshedFirst = await db.customerAddress.findUnique({ where: { id: first.id } });
      assert.equal(refreshedFirst?.isDefault, true, "the existing default must be unaffected");
    });
  });

  // F-325: PATCH /api/account/profile's password-change branch used to let
  // an already-authenticated session guess `currentPassword` with no rate
  // limit and no lockout counting — 40 wrong guesses in 16s, all a plain
  // 400. verifyCurrentPassword() is the shared logic the route now calls;
  // it needs no session cookie of its own (see the harness-limitation
  // comment at the top of this file), so it's exercised directly here.
  describe("verifyCurrentPassword (F-325)", () => {
    it("succeeds for the correct current password", async () => {
      const customer = await db.customer.create({
        data: { email: `pwchange-ok-${randomUUID()}@example.com`, name: "PW Change", passwordHash: await hashPassword("correct-password-1") },
      });
      createdCustomerIds.push(customer.id);
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);

      const result = await verifyCurrentPassword(
        jsonRequest("http://localhost/api/account/profile", "PATCH"),
        customer.id,
        "correct-password-1",
      );
      assert.deepEqual(result, { status: "ok" });
    });

    it("reports 'incorrect' (not locked) for a single wrong guess, and does not touch the rate limiter's job", async () => {
      const customer = await db.customer.create({
        data: { email: `pwchange-wrong-${randomUUID()}@example.com`, name: "PW Change", passwordHash: await hashPassword("correct-password-1") },
      });
      createdCustomerIds.push(customer.id);
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);

      const result = await verifyCurrentPassword(
        jsonRequest("http://localhost/api/account/profile", "PATCH"),
        customer.id,
        "wrong-guess",
      );
      assert.deepEqual(result, { status: "incorrect" });

      const updated = await db.customer.findUnique({ where: { id: customer.id } });
      assert.equal(updated!.failedLoginCount, 1, "a mismatch must feed the same lockout counter recordFailedLogin uses for login");
    });

    it("locks the account after enough wrong guesses, mirroring login's own threshold (F-325 core fix)", async () => {
      const customer = await db.customer.create({
        data: { email: `pwchange-lock-${randomUUID()}@example.com`, name: "PW Change", passwordHash: await hashPassword("correct-password-1") },
      });
      createdCustomerIds.push(customer.id);

      // Before the fix, none of this ever ran: every one of these 40
      // guesses (the finding's own repro count) returned a plain 400
      // with failedLoginCount/lockedUntil untouched. Each iteration
      // resets the separate per-IP/identity rate-limit bucket so this
      // test is only exercising the *lockout* counter, not the limiter.
      let lastResult: Awaited<ReturnType<typeof verifyCurrentPassword>> | undefined;
      for (let attempt = 1; attempt <= 10; attempt++) {
        await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
        lastResult = await verifyCurrentPassword(
          jsonRequest("http://localhost/api/account/profile", "PATCH"),
          customer.id,
          "wrong-guess",
        );
      }
      assert.equal(lastResult!.status, "locked", "the 10th wrong guess should lock the account, exactly like login");

      // Even the CORRECT password is now refused while locked — this is
      // what stops the "copied session + F-138" attack the finding
      // describes: the account locks before the real password can be
      // confirmed.
      await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);
      const correctButLocked = await verifyCurrentPassword(
        jsonRequest("http://localhost/api/account/profile", "PATCH"),
        customer.id,
        "correct-password-1",
      );
      assert.equal(correctButLocked.status, "locked");
    });

    it("rate-limits repeated guesses per account (account-password-change), independent of the lockout counter", async () => {
      // identityRateLimitOrResponse only attributes a request to an IP
      // (and therefore only actually limits) when getClientIp() trusts
      // the request — see src/lib/security/rate-limit.ts. The other
      // tests in this block use plain jsonRequest() (no trusted IP
      // header), which is exactly why they can hammer the lockout
      // counter without also tripping this limiter; this test explicitly
      // opts in with a Vercel-shaped request, mirroring
      // src/lib/security/rate-limit.test.ts's own identityRateLimitOrResponse
      // coverage.
      await withEnv({ NODE_ENV: "production", DISABLE_RATE_LIMIT: undefined, VERCEL: "1" }, async () => {
        const customer = await db.customer.create({
          data: { email: `pwchange-ratelimit-${randomUUID()}@example.com`, name: "PW Change", passwordHash: await hashPassword("correct-password-1") },
        });
        createdCustomerIds.push(customer.id);
        await resetRateLimits(ACCOUNT_RATE_LIMIT_PREFIXES);

        const requestFromIp = () =>
          new Request("http://localhost/api/account/profile", {
            method: "PATCH",
            headers: { "x-vercel-forwarded-for": "203.0.113.201" },
          });

        // The tight identity bucket is 5/min; stop just short of the
        // lockout threshold (10) so this test is isolated to the limiter.
        for (let attempt = 1; attempt <= 5; attempt++) {
          const result = await verifyCurrentPassword(requestFromIp(), customer.id, "wrong-guess");
          assert.notEqual(result.status, "rate-limited", `attempt ${attempt} should still be within the limit`);
        }

        const limited = await verifyCurrentPassword(requestFromIp(), customer.id, "wrong-guess");
        assert.equal(limited.status, "rate-limited");
        if (limited.status === "rate-limited") {
          assert.equal(limited.response.status, 429);
          assert.ok(limited.response.headers.get("Retry-After"));
        }
      });
    });
  });

  // F-138: Sign Out used to only clear the cookie — a copied/leaked token
  // kept verifying for the rest of its 30-day life. revokeCustomerSessions
  // is the shared logic POST /api/account/logout now calls first; tested
  // directly here (real DB row, real JWT) since — same harness limitation
  // as elsewhere in this file — calling the logout route itself can't
  // carry a real session cookie.
  describe("revokeCustomerSessions (F-138)", () => {
    it("a token minted before revocation is rejected (unauthenticated) afterwards", async () => {
      const customer = await db.customer.create({
        data: { email: `logout-revoke-${randomUUID()}@example.com`, name: "Logout Test", passwordHash: await hashPassword("correct-password-1") },
      });
      createdCustomerIds.push(customer.id);

      const tokenBeforeLogout = await signCustomerToken(customer.id, customer.sessionVersion);
      const before = await verifyCustomerSessionTokenResult(tokenBeforeLogout);
      assert.equal(before.status, "ok", "sanity check: the token verifies before revocation");

      await revokeCustomerSessions(customer.id);

      const after = await verifyCustomerSessionTokenResult(tokenBeforeLogout);
      assert.deepEqual(
        after,
        { status: "unauthenticated" },
        "a token minted before logout must stop verifying once sessionVersion is bumped",
      );
    });

    it("does not affect a token minted afterwards, at the new sessionVersion", async () => {
      const customer = await db.customer.create({
        data: { email: `logout-revoke-new-${randomUUID()}@example.com`, name: "Logout Test", passwordHash: await hashPassword("correct-password-1") },
      });
      createdCustomerIds.push(customer.id);

      await revokeCustomerSessions(customer.id);

      const refreshed = await db.customer.findUnique({ where: { id: customer.id } });
      const tokenAfterLogout = await signCustomerToken(customer.id, refreshed!.sessionVersion);
      const result = await verifyCustomerSessionTokenResult(tokenAfterLogout);
      assert.equal(result.status, "ok", "a fresh sign-in after logout must still work normally");
    });
  });

  describe("protected routes require a session (401 without one)", () => {
    it("GET /api/account/profile", async () => {
      assert.equal((await getProfile()).status, 401);
    });

    it("PATCH /api/account/profile", async () => {
      const response = await patchProfile(
        jsonRequest("http://localhost/api/account/profile", "PATCH", { name: "New Name" }),
      );
      assert.equal(response.status, 401);
    });

    it("GET /api/account/addresses", async () => {
      assert.equal((await getAddresses()).status, 401);
    });

    it("POST /api/account/addresses", async () => {
      const response = await postAddresses(
        jsonRequest("http://localhost/api/account/addresses", "POST", {
          line1: "1 Test Street",
          city: "Hyderabad",
          state: "Telangana",
          postalCode: "500001",
        }),
      );
      assert.equal(response.status, 401);
    });

    it("PATCH /api/account/addresses/:id", async () => {
      const response = await patchAddress(
        jsonRequest("http://localhost/api/account/addresses/whatever", "PATCH", { city: "Mumbai" }),
        { params: Promise.resolve({ id: "whatever" }) },
      );
      assert.equal(response.status, 401);
    });

    it("DELETE /api/account/addresses/:id", async () => {
      const response = await deleteAddress(
        new Request("http://localhost/api/account/addresses/whatever", { method: "DELETE" }),
        { params: Promise.resolve({ id: "whatever" }) },
      );
      assert.equal(response.status, 401);
    });

    it("GET /api/account/reviews", async () => {
      assert.equal((await getReviews()).status, 401);
    });
  });
});
