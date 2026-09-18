import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, formatRole, adminRoles, type Permission } from "@/lib/auth/rbac";
import type { AdminRole } from "@/generated/prisma/client";

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

  it("every role in adminRoles has at least one permission", () => {
    for (const role of adminRoles) {
      const allowed = ([
        "dashboard:view",
        "homepage:manage",
        "blog:manage",
        "bulk-orders:manage",
        "engagement:manage",
        "journeys:manage",
        "intelligence:view",
        "integrations:manage",
        "hermes:manage",
        "seo:manage",
        "offers:manage",
        "market:view",
        "testimonials:manage",
        "users:manage",
        "audit:view",
        "settings:manage",
        "products:view",
        "products:manage",
        "products:publish",
        "categories:manage",
        "media:manage",
        "ai:generate",
        "reviews:moderate",
        "orders:view",
        "orders:manage",
        "customers:view",
        "customers:manage",
        "shopify:sync",
      ] as Permission[]).some((permission) => hasPermission(role, permission));
      assert.equal(allowed, true, `${role} should have at least one permission`);
    }
  });

  describe("role matrix: allowed and denied key permissions per role", () => {
    const cases: {
      role: AdminRole;
      allowed: Permission[];
      denied: Permission[];
    }[] = [
      {
        role: "SUPER_ADMIN",
        allowed: [
          "users:manage",
          "settings:manage",
          "products:publish",
          "shopify:sync",
          "integrations:manage",
        ],
        denied: [],
      },
      {
        role: "STORE_OWNER",
        allowed: [
          "settings:manage",
          "products:publish",
          "orders:manage",
          "shopify:sync",
          "integrations:manage",
        ],
        denied: ["users:manage"],
      },
      {
        role: "CATALOG_MANAGER",
        allowed: ["products:view", "products:manage", "categories:manage", "media:manage", "ai:generate"],
        denied: ["products:publish", "orders:manage", "users:manage", "settings:manage"],
      },
      {
        role: "ORDER_MANAGER",
        allowed: ["orders:view", "orders:manage", "customers:view", "bulk-orders:manage"],
        denied: ["products:manage", "customers:manage", "users:manage", "settings:manage"],
      },
      {
        role: "MARKETING_ADMIN",
        allowed: ["homepage:manage", "settings:manage", "offers:manage"],
        // integrations:manage now gates payment/email credentials
        // (Razorpay, Brevo) via the admin UI, so it's deliberately kept
        // out of MARKETING_ADMIN — narrower than settings:manage,
        // SUPER_ADMIN/STORE_OWNER only.
        denied: ["users:manage", "products:manage", "orders:manage", "integrations:manage"],
      },
      {
        role: "CONTENT_EDITOR",
        allowed: ["blog:manage", "homepage:manage", "media:manage"],
        denied: ["users:manage", "orders:manage", "products:manage"],
      },
      {
        role: "SEO_MANAGER",
        allowed: ["seo:manage", "products:view"],
        denied: ["products:manage", "users:manage", "orders:manage"],
      },
      {
        role: "SUPPORT_AGENT",
        allowed: ["orders:view", "customers:view", "reviews:moderate", "bulk-orders:manage"],
        denied: ["orders:manage", "customers:manage", "products:manage", "users:manage"],
      },
      {
        role: "BULK_ORDER_MANAGER",
        allowed: ["bulk-orders:manage"],
        denied: ["engagement:manage", "orders:manage", "users:manage"],
      },
      {
        role: "VIEWER",
        allowed: ["dashboard:view", "intelligence:view", "audit:view"],
        denied: ["blog:manage", "users:manage", "products:manage", "settings:manage"],
      },
    ];

    for (const { role, allowed, denied } of cases) {
      it(`${role} matrix`, () => {
        for (const permission of allowed) {
          assert.equal(
            hasPermission(role, permission),
            true,
            `${role} should have ${permission}`,
          );
        }
        for (const permission of denied) {
          assert.equal(
            hasPermission(role, permission),
            false,
            `${role} should NOT have ${permission}`,
          );
        }
      });
    }
  });
});
