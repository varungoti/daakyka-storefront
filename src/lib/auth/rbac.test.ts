import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, formatRole } from "@/lib/auth/rbac";

describe("RBAC", () => {
  it("grants SUPER_ADMIN all key permissions", () => {
    assert.equal(hasPermission("SUPER_ADMIN", "users:manage"), true);
    assert.equal(hasPermission("SUPER_ADMIN", "hermes:manage"), true);
    assert.equal(hasPermission("SUPER_ADMIN", "seo:manage"), true);
  });

  it("blocks VIEWER from admin mutations", () => {
    assert.equal(hasPermission("VIEWER", "blog:manage"), false);
    assert.equal(hasPermission("VIEWER", "users:manage"), false);
    assert.equal(hasPermission("VIEWER", "dashboard:view"), true);
  });

  it("limits BULK_ORDER_MANAGER to bulk workflows", () => {
    assert.equal(hasPermission("BULK_ORDER_MANAGER", "bulk-orders:manage"), true);
    assert.equal(hasPermission("BULK_ORDER_MANAGER", "engagement:manage"), false);
  });

  it("formats role labels for display", () => {
    assert.equal(formatRole("SEO_MANAGER"), "Seo Manager");
    assert.equal(formatRole("SUPER_ADMIN"), "Super Admin");
  });
});
