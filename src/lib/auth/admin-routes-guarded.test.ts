import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Walks src/app/api/admin looking for every route.ts file and asserts it
// references requireAdminPermission, so no admin API route can ship without
// an RBAC check. This is a static, filesystem-only test (no server startup).

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry === "route.ts") {
      results.push(fullPath);
    }
  }
  return results;
}

describe("admin API routes are RBAC-guarded", () => {
  const adminApiDir = join(process.cwd(), "src", "app", "api", "admin");
  const routeFiles = findRouteFiles(adminApiDir);

  it("finds at least one admin route to check", () => {
    assert.ok(routeFiles.length > 0, "expected to find admin route.ts files");
  });

  for (const routeFile of routeFiles) {
    const relativePath = routeFile.split("storefront")[1] ?? routeFile;
    it(`${relativePath} calls requireAdminPermission`, () => {
      const contents = readFileSync(routeFile, "utf8");
      assert.match(
        contents,
        /requireAdminPermission\s*\(/,
        `${routeFile} must call requireAdminPermission(...) to guard every handler`,
      );
    });
  }
});

/**
 * F-062: the dashboard, the blog editor (`blog/new`, `blog/[id]`) and the
 * admin index redirect used to be the only `page.tsx` files under
 * src/app/admin/(panel) that never called `getSession()` — they relied
 * entirely on the (panel) layout's DB-backed session check, which does
 * NOT re-run on a client-side (RSC) navigation. A deactivated or demoted
 * admin whose tab was already open could keep reaching those pages'
 * fresh data by soft-navigating to them, for up to the session token's
 * 7-day life. Every one of those pages now calls either `getSession()`
 * directly (the existing, already-common pattern — see e.g.
 * audit-logs/page.tsx) or the `requireAdminPage()` helper
 * (src/lib/auth/require-admin-page.ts) that wraps it. This walks every
 * page.tsx under (panel) and asserts one of the two is present, so a
 * future page can't ship depending on the layout alone.
 */
function findPageFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findPageFiles(fullPath));
    } else if (entry === "page.tsx") {
      results.push(fullPath);
    }
  }
  return results;
}

describe("admin panel pages re-check the session on every request (F-062)", () => {
  const panelDir = join(process.cwd(), "src", "app", "admin", "(panel)");
  const pageFiles = findPageFiles(panelDir);

  // The index route only ever does `redirect("/admin/dashboard")` and
  // renders nothing of its own — the dashboard it hands off to enforces
  // the real check.
  const EXEMPT = new Set([join(panelDir, "page.tsx")]);

  it("finds at least one admin panel page to check", () => {
    assert.ok(pageFiles.length > 0, "expected to find admin (panel) page.tsx files");
  });

  for (const pageFile of pageFiles.filter((file) => !EXEMPT.has(file))) {
    const relativePath = pageFile.split("storefront")[1] ?? pageFile;
    it(`${relativePath} calls getSession or requireAdminPage`, () => {
      const contents = readFileSync(pageFile, "utf8");
      assert.match(
        contents,
        /getSession\s*\(|requireAdminPage\s*\(/,
        `${pageFile} must call getSession(...) or requireAdminPage(...) — it can't rely on the (panel) layout alone, which doesn't re-run on a soft navigation`,
      );
    });
  }
});
