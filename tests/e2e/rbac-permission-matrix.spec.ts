import { test, expect, type APIRequestContext } from "@playwright/test";
import type { AdminRole } from "@/generated/prisma/client";
import {
  cleanupRbacMatrixUsers,
  createSessionsForAllRoles,
  type RoleSession,
} from "./helpers/rbac-sessions";

/**
 * release-hardening item 2 (F13, docs/audit-2026-09-19/correctness.md):
 * `src/lib/auth/admin-routes-guarded.test.ts` only proves every admin API
 * route SOURCE FILE calls requireAdminPermission(...) somewhere — a
 * static, string-match check with no server involved. `rbac.test.ts`
 * separately unit-tests hasPermission() in isolation. Neither proves the
 * two are actually wired together correctly for a real HTTP request —
 * that a session with the wrong role genuinely gets a 403 from the real
 * route, not just from the pure permission-matrix function.
 *
 * This spec closes that gap: one real HTTP request per (permission,
 * role) pair against a representative protected route for that
 * permission, run against the actual built server the `e2e` CI job
 * already starts (see .github/workflows/storefront-verify.yml). It uses
 * Playwright's `request` context (no browser page/rendering) so the
 * added CI cost is a couple of dozen fast HTTP calls, not new browser
 * time.
 *
 * Two permissions are intentionally NOT covered:
 *  - "shopify:sync": defined in the Permission union and granted to
 *    SUPER_ADMIN/STORE_OWNER, but no route anywhere calls
 *    requireAdminPermission("shopify:sync") (confirmed by grep across
 *    src/app) — there is no representative route to test against. Noted
 *    here rather than silently skipped.
 *  - "dashboard:view": granted to every single AdminRole (see
 *    rolePermissions in src/lib/auth/rbac.ts), so there is no role that
 *    should be denied it — no meaningful boundary to assert.
 */

type Expectation =
  | { kind: "api"; method: "GET" | "PATCH" | "PUT" | "POST"; path: string }
  // Next.js 16 (see node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md,
  // "streaming context" note) resolves a Server Component's redirect() by
  // streaming the REDIRECT TARGET's own rendered HTML back with a 200,
  // not a bare 3xx, for a plain HTTP client (confirmed empirically — see
  // the comment on callPage below) — so "denied" is asserted by the
  // ALLOWED page's own heading text being absent from the body, not by
  // status code.
  | { kind: "page"; path: string; allowedMarker: string };

interface MatrixCase {
  permission: string;
  allowRole: AdminRole;
  denyRole: AdminRole;
  route: Expectation;
}

// Representative route + one role that HAS the permission + one role
// that does NOT, per permission. Denials default to VIEWER (the
// narrowest role) except where VIEWER itself holds that permission, in
// which case a role one step up the ladder that still lacks it is used
// instead — see the comment on each of those rows.
const MATRIX: MatrixCase[] = [
  { permission: "products:view", allowRole: "CATALOG_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/products" } },
  { permission: "products:manage", allowRole: "CATALOG_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/products/export" } },
  { permission: "categories:manage", allowRole: "CATALOG_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/categories" } },
  { permission: "media:manage", allowRole: "CATALOG_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/media" } },
  { permission: "ai:generate", allowRole: "CATALOG_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "POST", path: "/api/admin/media/generate" } },
  { permission: "reviews:moderate", allowRole: "SUPPORT_AGENT", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/reviews" } },
  { permission: "orders:view", allowRole: "ORDER_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/orders" } },
  // SUPPORT_AGENT has orders:view but not orders:manage — a real
  // adjacent-permission boundary, not just "no permissions at all".
  { permission: "orders:manage", allowRole: "ORDER_MANAGER", denyRole: "SUPPORT_AGENT", route: { kind: "api", method: "PATCH", path: "/api/admin/orders/rbac-matrix-missing-id" } },
  { permission: "customers:view", allowRole: "ORDER_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/customers" } },
  // Only SUPER_ADMIN/STORE_OWNER have customers:manage; ORDER_MANAGER
  // has customers:view but not customers:manage.
  { permission: "customers:manage", allowRole: "SUPER_ADMIN", denyRole: "ORDER_MANAGER", route: { kind: "api", method: "PATCH", path: "/api/admin/customers/rbac-matrix-missing-id" } },
  // The single most important boundary in the whole matrix: STORE_OWNER
  // is explicitly everything-but-users:manage (see rbac.ts's comment).
  { permission: "users:manage", allowRole: "SUPER_ADMIN", denyRole: "STORE_OWNER", route: { kind: "api", method: "GET", path: "/api/admin/users" } },
  { permission: "homepage:manage", allowRole: "MARKETING_ADMIN", denyRole: "VIEWER", route: { kind: "api", method: "PUT", path: "/api/admin/homepage/hero" } },
  { permission: "blog:manage", allowRole: "CONTENT_EDITOR", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/blog" } },
  { permission: "bulk-orders:manage", allowRole: "BULK_ORDER_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "PATCH", path: "/api/admin/bulk-orders/rbac-matrix-missing-id" } },
  { permission: "engagement:manage", allowRole: "MARKETING_ADMIN", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/campaigns" } },
  { permission: "journeys:manage", allowRole: "MARKETING_ADMIN", denyRole: "VIEWER", route: { kind: "api", method: "PATCH", path: "/api/admin/journeys/rbac-matrix-missing-id" } },
  // BULK_ORDER_MANAGER lacks intelligence:view (it only has dashboard:view + bulk-orders:manage).
  { permission: "intelligence:view", allowRole: "SEO_MANAGER", denyRole: "BULK_ORDER_MANAGER", route: { kind: "page", path: "/admin/intelligence", allowedMarker: "Product Intelligence" } },
  // MARKETING_ADMIN is explicitly denied integrations:manage (see the
  // comment in rbac.ts / rbac.test.ts — payment/email credentials are
  // deliberately narrower than the rest of settings:manage).
  { permission: "integrations:manage", allowRole: "SUPER_ADMIN", denyRole: "MARKETING_ADMIN", route: { kind: "api", method: "PATCH", path: "/api/admin/integrations/shopify" } },
  { permission: "seo:manage", allowRole: "SEO_MANAGER", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/seo" } },
  { permission: "offers:manage", allowRole: "MARKETING_ADMIN", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/offers" } },
  { permission: "market:view", allowRole: "MARKETING_ADMIN", denyRole: "VIEWER", route: { kind: "page", path: "/admin/market", allowedMarker: "Market Intelligence" } },
  { permission: "testimonials:manage", allowRole: "CONTENT_EDITOR", denyRole: "VIEWER", route: { kind: "api", method: "GET", path: "/api/admin/testimonials" } },
  // VIEWER is one of only three roles with audit:view — worth proving a
  // narrow role's one real permission actually works, not just denials.
  { permission: "audit:view", allowRole: "VIEWER", denyRole: "BULK_ORDER_MANAGER", route: { kind: "page", path: "/admin/audit-logs", allowedMarker: "Audit Logs" } },
  { permission: "settings:manage", allowRole: "MARKETING_ADMIN", denyRole: "VIEWER", route: { kind: "api", method: "PATCH", path: "/api/admin/settings/shipping" } },
  { permission: "hermes:manage", allowRole: "MARKETING_ADMIN", denyRole: "VIEWER", route: { kind: "api", method: "POST", path: "/api/admin/hermes/tasks" } },
];

async function callApi(
  request: APIRequestContext,
  session: RoleSession,
  method: "GET" | "PATCH" | "PUT" | "POST",
  path: string,
): Promise<number> {
  const headers = { Cookie: session.cookie, "Content-Type": "application/json" };
  const response =
    method === "GET"
      ? await request.get(path, { headers })
      : method === "PATCH"
        ? await request.patch(path, { headers, data: {} })
        : method === "PUT"
          ? await request.put(path, { headers, data: {} })
          : await request.post(path, { headers, data: {} });
  return response.status();
}

/** Confirmed empirically (see the comment on the `page` Expectation
 * variant above) that a denied Server Component redirect() streams back
 * the redirect TARGET's own HTML with a 200 to a plain HTTP client, not
 * a bare 3xx — so this checks for the ALLOWED page's own heading text
 * rather than trusting the status code either way. */
async function fetchPageBody(
  request: APIRequestContext,
  session: RoleSession,
  path: string,
): Promise<string> {
  const response = await request.get(path, {
    headers: { Cookie: session.cookie },
    maxRedirects: 0,
  });
  return response.text();
}

test.describe("RBAC permission matrix (real HTTP, one request per role)", () => {
  let sessions: Record<AdminRole, RoleSession>;

  test.beforeAll(async () => {
    await cleanupRbacMatrixUsers();
    sessions = await createSessionsForAllRoles();
  });

  test.afterAll(async () => {
    await cleanupRbacMatrixUsers();
  });

  for (const testCase of MATRIX) {
    test(`${testCase.permission}: ${testCase.allowRole} allowed, ${testCase.denyRole} denied`, async ({
      request,
    }) => {
      const allowSession = sessions[testCase.allowRole];
      const denySession = sessions[testCase.denyRole];

      if (testCase.route.kind === "page") {
        const { allowedMarker, path } = testCase.route;
        const allowBody = await fetchPageBody(request, allowSession, path);
        expect(
          allowBody.includes(allowedMarker),
          `${testCase.allowRole} (has ${testCase.permission}) should see "${allowedMarker}" at ${path}`,
        ).toBe(true);

        const denyBody = await fetchPageBody(request, denySession, path);
        expect(
          denyBody.includes(allowedMarker),
          `${testCase.denyRole} (lacks ${testCase.permission}) should NOT see "${allowedMarker}" at ${path} (should have been redirected away)`,
        ).toBe(false);
        return;
      }

      const allowStatus = await callApi(
        request,
        allowSession,
        testCase.route.method,
        testCase.route.path,
      );
      expect(
        [401, 403].includes(allowStatus),
        `${testCase.allowRole} (has ${testCase.permission}) got ${allowStatus} from ${testCase.route.method} ${testCase.route.path} — expected past the permission gate (not 401/403)`,
      ).toBe(false);

      const denyStatus = await callApi(
        request,
        denySession,
        testCase.route.method,
        testCase.route.path,
      );
      expect(
        denyStatus,
        `${testCase.denyRole} (lacks ${testCase.permission}) should get 403 from ${testCase.route.method} ${testCase.route.path}, got ${denyStatus}`,
      ).toBe(403);
    });
  }

  test("a request with no session cookie at all is rejected (401), never a false-allow", async ({
    request,
  }) => {
    const response = await request.get("/api/admin/products");
    expect(response.status()).toBe(401);
  });
});
