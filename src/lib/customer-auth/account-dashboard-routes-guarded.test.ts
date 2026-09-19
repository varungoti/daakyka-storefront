import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Release-hardening item 1 (F4 — see docs/audit-2026-09-19/storefront-ux.md
 * and the "Bookmarkable account sections" row of its Shopify parity
 * table). Companion to account-routes-guarded.test.ts (which covers
 * /api/account/** route handlers) for the new page routes under
 * src/app/account/(dashboard)/**.
 *
 * What this can and can't verify, and why (matches this repo's existing
 * harness limitation — see the top-of-file comment in
 * tests/integration/customer-auth.test.ts and routing.test.ts's note
 * that full-page HTTP checks need a real running server): `cookies()`
 * throws outside a real Next.js request, so a page component can't
 * actually be *rendered* here to observe a real redirect. Instead this
 * statically asserts the source of every affected file contains the
 * expected auth-guard call — the same style account-routes-guarded.test.ts
 * already uses for the API routes. The following still need a real
 * browser/server (see this task's report for what to check manually):
 *   - a logged-out visitor actually receives a 302 to /account/login for
 *     every section
 *   - deep-linking, refresh, and back/forward across sections
 *   - the shared shell/nav not remounting between section navigations
 */
describe("/account/(dashboard) page routes are guarded consistently (release-hardening item 1)", () => {
  const accountAppDir = join(process.cwd(), "src", "app", "account");
  const dashboardDir = join(accountAppDir, "(dashboard)");

  it("the (dashboard) layout exists and gates every nested route with getCustomerSession + redirect", () => {
    const contents = readFileSync(join(dashboardDir, "layout.tsx"), "utf8");
    assert.match(contents, /getCustomerSession\s*\(/, "the dashboard layout must call getCustomerSession()");
    assert.match(contents, /if\s*\(\s*!session\s*\)\s*\{?\s*redirect\(/, "the dashboard layout must redirect when there is no session");
    assert.match(contents, /redirect\(\s*["'`]\/account\/login/, "should redirect to /account/login, not somewhere unguarded");
  });

  const LEAF_PAGES = [
    "orders/page.tsx",
    "orders/[number]/page.tsx",
    "addresses/page.tsx",
    "reviews/page.tsx",
    "wishlist/page.tsx",
    "profile/page.tsx",
  ];

  it("every real account section has its own route file", () => {
    for (const relative of LEAF_PAGES) {
      const fullPath = join(dashboardDir, relative);
      assert.ok(existsSync(fullPath), `${relative} should exist under src/app/account/(dashboard)/`);
    }
    assert.ok(existsSync(join(dashboardDir, "page.tsx")), "/account itself should still resolve to something (a redirect to the default section)");
  });

  for (const relative of LEAF_PAGES) {
    it(`${relative} also calls getCustomerSession itself (own-data-fetch, on top of the layout's gate)`, () => {
      const contents = readFileSync(join(dashboardDir, relative), "utf8");
      assert.match(
        contents,
        /getCustomerSession\s*\(/,
        `${relative} must call getCustomerSession() — it needs session.id for its own scoped query, per the layout's doc comment`,
      );
      assert.match(
        contents,
        /redirect\(\s*["'`]\/account\/login/,
        `${relative} should defensively redirect to /account/login if somehow reached with no session`,
      );
    });
  }

  it("the order detail route authorizes by session ownership only — never a guest access token", () => {
    const contents = readFileSync(join(dashboardDir, "orders", "[number]", "page.tsx"), "utf8");
    assert.match(contents, /getAuthorizedOrder\s*\(/, "must reuse the same authorization primitive as the guest order page");
    assert.match(
      contents,
      /token:\s*null/,
      "must always pass token: null — a logged-in customer is authorized by session, never by a capability token from a URL",
    );
    assert.match(contents, /customerId:\s*session\.id/, "must scope the lookup to the caller's own session id");
  });

  it("does not modify the protected order-access-token module or the guest order route", () => {
    // These two paths are explicitly out of scope for this change (owned
    // by another workstream) — this is a lightweight guard against a
    // future edit to this file set accidentally touching them.
    assert.ok(existsSync(join(process.cwd(), "src", "lib", "orders", "access-token.ts")));
    assert.ok(existsSync(join(process.cwd(), "src", "app", "order", "[number]", "page.tsx")));
  });

  const PUBLIC_AUTH_PAGES = [
    "login/page.tsx",
    "register/page.tsx",
    "forgot-password/page.tsx",
    "reset-password/page.tsx",
    "verify-email/page.tsx",
  ];

  it("public auth pages stay outside the (dashboard) route group, so they're never wrapped in its auth gate", () => {
    for (const relative of PUBLIC_AUTH_PAGES) {
      assert.ok(existsSync(join(accountAppDir, relative)), `${relative} should exist directly under src/app/account/`);
      const segment = relative.split("/")[0];
      assert.ok(
        !existsSync(join(dashboardDir, segment)),
        `${segment} must not also exist inside (dashboard) — that would be a conflicting/duplicate route`,
      );
    }
  });

  it("the old single-page /account dashboard (all sections as client tab state) is gone, not just superseded", () => {
    assert.ok(
      !existsSync(join(accountAppDir, "page.tsx")),
      "src/app/account/page.tsx must not exist outside the (dashboard) group — Next.js would treat that as a conflicting route with (dashboard)/page.tsx",
    );
  });
});
