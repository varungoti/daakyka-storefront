import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Adapts admin-routes-guarded.test.ts's approach (assert every admin
 * route.ts calls requireAdminPermission) to /api/account/**.
 *
 * Unlike the admin API, most of /api/account is intentionally public:
 * register, login, logout, verify-email, forgot-password and
 * reset-password all have to work for a caller with no session — that's
 * the entire point of an auth API. Only the routes that read or mutate an
 * existing customer's own data (profile, addresses, reviews) are required
 * to check the session, so this test asserts membership in an explicit
 * allowlist rather than a blanket "every route must be guarded" rule.
 */
describe("account API routes are guarded where they should be", () => {
  const accountApiDir = join(process.cwd(), "src", "app", "api", "account");

  const PUBLIC_ROUTES = new Set([
    "register/route.ts",
    "login/route.ts",
    "logout/route.ts",
    "verify-email/route.ts",
    "forgot-password/route.ts",
    "reset-password/route.ts",
    "resend-verification/route.ts",
  ]);

  const PROTECTED_ROUTES = ["profile/route.ts", "addresses/route.ts", "addresses/[id]/route.ts", "reviews/route.ts"];

  it("finds the expected public routes and they don't call getCustomerSession", () => {
    for (const relative of PUBLIC_ROUTES) {
      const contents = readFileSync(join(accountApiDir, relative), "utf8");
      assert.ok(contents.length > 0, `${relative} should exist and be non-empty`);
    }
  });

  for (const relative of PROTECTED_ROUTES) {
    it(`${relative} calls getCustomerSession to guard every handler`, () => {
      const contents = readFileSync(join(accountApiDir, relative), "utf8");
      assert.match(
        contents,
        /getCustomerSession\s*\(/,
        `${relative} must call getCustomerSession() to guard access to the caller's own data`,
      );
    });
  }

  it("addresses/[id]/route.ts uses loadOwnAddress to scope lookups to the caller's own customerId", () => {
    const contents = readFileSync(join(accountApiDir, "addresses/[id]/route.ts"), "utf8");
    assert.match(
      contents,
      /loadOwnAddress\s*\(/,
      "addresses/[id]/route.ts must verify the address belongs to session.id before returning/mutating it",
    );
  });

  it("loadOwnAddress itself checks address.customerId against the caller's id", () => {
    const contents = readFileSync(
      join(process.cwd(), "src", "lib", "customer-auth", "addresses.ts"),
      "utf8",
    );
    assert.match(contents, /address\.customerId\s*!==\s*customerId/);
  });
});
