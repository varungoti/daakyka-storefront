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
