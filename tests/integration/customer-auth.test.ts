import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { hashPassword, verifyPassword } from "@/lib/customer-auth/password";
import { issueCustomerToken } from "@/lib/customer-auth/tokens";
import { loadOwnAddress } from "@/lib/customer-auth/addresses";

import { POST as postRegister } from "@/app/api/account/register/route";
import { POST as postLogin } from "@/app/api/account/login/route";
import { GET as getVerifyEmail } from "@/app/api/account/verify-email/route";
import { POST as postForgotPassword } from "@/app/api/account/forgot-password/route";
import { POST as postResetPassword } from "@/app/api/account/reset-password/route";
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
describe("customer accounts (Phase D1)", () => {
  const createdCustomerIds: string[] = [];

  after(async () => {
    await db.customerToken.deleteMany({ where: { customerId: { in: createdCustomerIds } } }).catch(() => {});
    await db.customerAddress.deleteMany({ where: { customerId: { in: createdCustomerIds } } }).catch(() => {});
    await db.review.deleteMany({ where: { customerId: { in: createdCustomerIds } } }).catch(() => {});
    await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
  });

  describe("POST /api/account/register", () => {
    it("creates an unverified customer and issues a VERIFY token, logging the dev fallback link", async () => {
      await resetRateLimits();
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
      await resetRateLimits();
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
      await resetRateLimits();
      const unique = randomUUID().slice(0, 8);
      const email = `dup-${unique}@example.com`;
      const customer = await db.customer.create({
        data: { email, name: "Existing", passwordHash: await hashPassword("password123") },
      });
      createdCustomerIds.push(customer.id);

      await resetRateLimits();
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
      await resetRateLimits();
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

      await resetRateLimits();
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

      await resetRateLimits();
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
        await resetRateLimits();
        const response = await postLogin(
          jsonRequest("http://localhost/api/account/login", "POST", {
            email,
            password: "wrong-password",
          }),
        );
        assert.equal(response.status, 401, `attempt ${attempt} should still be a plain 401`);
      }

      await resetRateLimits();
      const lockedResponse = await postLogin(
        jsonRequest("http://localhost/api/account/login", "POST", {
          email,
          password: "wrong-password",
        }),
      );
      assert.equal(lockedResponse.status, 423, "the 10th failed attempt should lock the account");

      const locked = await db.customer.findUnique({ where: { id: customer.id } });
      assert.ok(locked!.lockedUntil && locked!.lockedUntil.getTime() > Date.now());

      // Even the correct password is rejected while locked.
      await resetRateLimits();
      const correctButLocked = await postLogin(
        jsonRequest("http://localhost/api/account/login", "POST", {
          email,
          password: "correct-password-1",
        }),
      );
      assert.equal(correctButLocked.status, 423);
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

      await resetRateLimits();
      const existingResponse = await postForgotPassword(
        jsonRequest("http://localhost/api/account/forgot-password", "POST", { email }),
      );
      const existingBody = await existingResponse.json();

      await resetRateLimits();
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
