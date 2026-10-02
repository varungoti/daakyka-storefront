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
    // F-131 fix: the no-session branch now also computes a returnTo from
    // the request's real path (via the `x-pathname` header src/proxy.ts
    // sets) before calling redirect(), instead of jumping to a fixed
    // string — so this only checks that a redirect() call appears
    // somewhere inside the `if (!session)` block, not immediately after
    // its opening brace.
    assert.match(
      contents,
      /if\s*\(\s*!session\s*\)\s*\{[\s\S]{0,1000}?redirect\(/,
      "the dashboard layout must redirect when there is no session",
    );
    // F-131: through accountLoginPath(), which builds /account/login?returnTo=<encoded path>.
    assert.match(
      contents,
      /redirect\(\s*accountLoginPath\(/,
      "should redirect to /account/login (via accountLoginPath), not somewhere unguarded",
    );
    assert.match(
      contents,
      /accountLoginPath\(\s*currentPath \|\| "\/account"\s*\)/,
      "must send the visitor back to the page the proxy recorded in x-pathname",
    );
  });

  const LEAF_PAGES = [
    "orders/page.tsx",
    "orders/[number]/page.tsx",
    "addresses/page.tsx",
    "reviews/page.tsx",
    "wishlist/page.tsx",
    "profile/page.tsx",
  ];

  // Where each leaf's own sign-in redirect must send the visitor back to.
  const RETURN_TO: Record<string, string> = {
    "orders/page.tsx": "/account/orders",
    "orders/[number]/page.tsx": "/account/orders/",
    "addresses/page.tsx": "/account/addresses",
    "reviews/page.tsx": "/account/reviews",
    "wishlist/page.tsx": "/account/wishlist",
    "profile/page.tsx": "/account/profile",
  };

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
        /redirect\(\s*accountLoginPath\(/,
        `${relative} should defensively redirect to /account/login (via accountLoginPath) if somehow reached with no session`,
      );
      // F-131: the defensive redirect carries this page's own path as returnTo (the
      // order detail page its order number, the list its ?page=) — never the bare
      // /account the layout used to hard-code.
      assert.ok(
        contents.includes(`"${RETURN_TO[relative]}`) || contents.includes(`\`${RETURN_TO[relative]}`),
        `${relative} must return the visitor to ${RETURN_TO[relative]}`,
      );
      assert.ok(!/returnTo=\/account["'`]/.test(contents), `${relative} must not hard-code returnTo=/account`);
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

/**
 * F-328: printing an order used to give 2-3 pages of site chrome. The guest page
 * (src/app/order/[number]/page.tsx) and the signed-in one share the receipt
 * facts and print treatment; the helpers are unit-tested in
 * src/lib/orders/receipt.test.ts, and the page markup (no DOM in this harness)
 * is pinned here the same way the auth guards above are.
 */
describe("the signed-in order page prints as a receipt, like the guest page (F-328)", () => {
  const dashboardDir = join(process.cwd(), "src", "app", "account", "(dashboard)");
  const signedIn = readFileSync(join(dashboardDir, "orders", "[number]", "page.tsx"), "utf8");
  const guest = readFileSync(join(process.cwd(), "src", "app", "order", "[number]", "page.tsx"), "utf8");

  for (const [name, source] of [
    ["signed-in", signedIn],
    ["guest", guest],
  ] as const) {
    it(`the ${name} page offers Print receipt and states the order date and payment status`, () => {
      assert.match(source, /<OrderPrintButton\s*\/>/);
      assert.match(source, /formatReceiptDate\(order\.createdAt\)/);
      assert.match(source, /getReceiptPaymentSummary\(/);
      assert.match(source, /Placed \{placedDate\} · \{paymentSummary\}/);
    });

    it(`the ${name} page names the seller (legal name, address, GSTIN when set) and keeps its sections whole across a page break`, () => {
      assert.match(source, /<h2[^>]*>Sold by<\/h2>/);
      assert.match(source, /brand\.legalName/);
      assert.match(source, /getSetting\("legal\.gstin"\)/);
      assert.match(source, /getSetting\("contact\.address"\)/);
      assert.ok((source.match(/print:break-inside-avoid/g) ?? []).length >= 4, "items, totals, shipping and seller blocks");
    });

    it(`the ${name} page leaves the transient status timeline and tracking card off the printed copy`, () => {
      assert.match(source, /print:hidden[^\n]*>\s*\n\s*<h2[^>]*>Order status<\/h2>/);
      assert.match(source, /print:hidden[^\n]*>\s*\n\s*<OrderTrackingCard/);
    });
  }

  it("the account hero band and tab bar are hidden from print", () => {
    const layout = readFileSync(join(dashboardDir, "layout.tsx"), "utf8");
    assert.match(layout, /<div className="print:hidden">\s*<PageHeroBand/);
    assert.match(layout, /<div className="print:hidden">\s*<AccountNav \/>/);
  });

  it("the signed-in page's back link and review / buy-again actions are hidden from print", () => {
    assert.match(signedIn, /href="\/account\/orders"[^>]*print:hidden/);
    assert.match(signedIn, /print:hidden">\s*\{canReview/);
  });

  it("the site chrome (utility bar, header, footer, WhatsApp bubble) is print:hidden in the shell", () => {
    const shell = readFileSync(join(process.cwd(), "src", "components", "layout", "site-shell.tsx"), "utf8");
    assert.ok((shell.match(/print:hidden/g) ?? []).length >= 4);
    const button = readFileSync(join(process.cwd(), "src", "components", "account", "order-print-button.tsx"), "utf8");
    assert.match(button, /window\.print\(\)/);
    assert.match(button, /print:hidden/);
  });
});
