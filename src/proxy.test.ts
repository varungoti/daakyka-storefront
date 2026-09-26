import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-auth/constants";
import { proxy } from "@/proxy";

/**
 * F-131 fix: every protected /account/* page used to redirect a signed-out
 * visitor to the fixed `/account/login?returnTo=/account`
 * (src/app/account/(dashboard)/layout.tsx), so signing in from a deep link
 * (a bookmarked order, an addresses page) always bounced back to /account
 * instead of where they were headed. The redirect now happens here, in
 * Proxy, as a real 307 that carries the full original path — see proxy.ts's
 * own doc comment for why this is only a cheap cookie-*presence* check,
 * never the authorization decision itself (the layout's own
 * getCustomerSession() call remains that).
 */

function accountRequest(path: string, opts: { sessionCookie?: string } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: opts.sessionCookie ? { cookie: `${CUSTOMER_SESSION_COOKIE}=${opts.sessionCookie}` } : undefined,
  });
}

describe("proxy — /account/* gate (F-131 fix)", () => {
  it("redirects a signed-out request for a protected deep link to /account/login carrying the full path as returnTo", async () => {
    const response = await proxy(accountRequest("/account/orders/DK-2026-0000000001"));
    const location = response.headers.get("location");
    assert.ok(location, "expected a redirect Location header");

    const url = new URL(location!);
    assert.equal(url.pathname, "/account/login");
    assert.equal(
      url.searchParams.get("returnTo"),
      "/account/orders/DK-2026-0000000001",
      "returnTo must be the exact page the shopper asked for, not a fixed fallback",
    );
  });

  it("preserves a query string on the deep link's returnTo", async () => {
    const response = await proxy(accountRequest("/account/orders?page=2"));
    const url = new URL(response.headers.get("location")!);
    assert.equal(url.searchParams.get("returnTo"), "/account/orders?page=2");
  });

  it("does not redirect a public account page (login) even with no session cookie", async () => {
    const response = await proxy(accountRequest("/account/login"));
    assert.equal(response.headers.get("location"), null, "login itself must stay reachable while signed out");
  });

  it("does not redirect the other public account pages either", async () => {
    for (const path of ["/account/register", "/account/forgot-password", "/account/reset-password", "/account/verify-email"]) {
      const response = await proxy(accountRequest(path));
      assert.equal(response.headers.get("location"), null, `${path} must stay reachable while signed out`);
    }
  });

  it("lets a request through (no redirect) once a session cookie is present", async () => {
    const response = await proxy(accountRequest("/account/addresses", { sessionCookie: "some-jwt-value" }));
    assert.equal(
      response.headers.get("location"),
      null,
      "a cookie-presence check must not itself reject a real (if since-expired) session — the layout's getCustomerSession() is the authoritative check for that",
    );
  });

  it("sets x-pathname (the full path + query) on every /account/* request, so the layout can build returnTo for the rarer expired-cookie case", async () => {
    const response = await proxy(accountRequest("/account/addresses?foo=bar", { sessionCookie: "some-jwt-value" }));
    assert.equal(response.headers.get("x-middleware-request-x-pathname"), "/account/addresses?foo=bar");
  });

  it("leaves unrelated routes untouched", async () => {
    const response = await proxy(new NextRequest("http://localhost/shop"));
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-middleware-request-x-pathname"), null);
  });
});
