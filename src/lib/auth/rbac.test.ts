import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasPermission, formatRole, adminRoles, type Permission } from "@/lib/auth/rbac";
import { productRowLinks } from "@/lib/admin/product-links";
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
        "settings:marketing",
        "products:view",
        "products:manage",
        "products:publish",
        "categories:manage",
        "media:manage",
        "media:view",
        "ai:generate",
        "reviews:moderate",
        "orders:view",
        "orders:manage",
        "customers:view",
        "customers:manage",
        "privacy:manage",
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
          "privacy:manage",
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
          // F-315: the owner answers access / erasure requests.
          "privacy:manage",
        ],
        denied: ["users:manage"],
      },
      {
        role: "CATALOG_MANAGER",
        allowed: ["products:view", "products:manage", "categories:manage", "media:manage", "ai:generate"],
        denied: ["products:publish", "orders:manage", "users:manage", "settings:manage", "privacy:manage"],
      },
      {
        role: "ORDER_MANAGER",
        allowed: ["orders:view", "orders:manage", "customers:view", "bulk-orders:manage"],
        denied: ["products:manage", "customers:manage", "users:manage", "settings:manage", "privacy:manage"],
      },
      {
        role: "MARKETING_ADMIN",
        allowed: ["homepage:manage", "settings:marketing", "offers:manage", "media:view"],
        // integrations:manage now gates payment/email credentials
        // (Razorpay, Brevo) via the admin UI, so it's deliberately kept
        // out of MARKETING_ADMIN — narrower than settings:manage,
        // SUPER_ADMIN/STORE_OWNER only.
        //
        // F-061: "settings:manage" itself is now denied too — it used to be
        // granted wholesale (with only a comment claiming a narrower scope),
        // letting this role change shipping rates and the public contact
        // details/order-alert inbox. "settings:marketing" (above) is the
        // narrower permission that actually gets enforced per-key now (see
        // src/lib/settings/permissions.ts).
        denied: [
          "users:manage",
          "products:manage",
          "orders:manage",
          "integrations:manage",
          "settings:manage",
          "media:manage",
        ],
      },
      {
        role: "CONTENT_EDITOR",
        allowed: ["blog:manage", "homepage:manage", "media:manage", "media:view"],
        denied: ["users:manage", "orders:manage", "products:manage"],
      },
      {
        role: "SEO_MANAGER",
        // F-291: read-only media access, so this role can pick an existing
        // image for a homepage hero slide (it already holds
        // "homepage:manage") without gaining upload/delete rights.
        allowed: ["seo:manage", "products:view", "media:view"],
        denied: ["products:manage", "users:manage", "orders:manage", "media:manage"],
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

// F-162: the products list is open to products:view, but the editor behind
// each row needs products:manage and silently bounces everyone else to the
// dashboard. productRowLinks decides what a row links to for a viewer — it
// must never hand a role an /admin/products/<id> link that role can't open.
describe("product list links per role (F-162)", () => {
  const liveProduct = { id: "cmugsi0g300llh4ohwgss2d14", slug: "classic-scrub-top", status: "ACTIVE" };
  const draftProduct = { id: "cmugsi0g300llh4ohwgss2d15", slug: "draft-scrub-top", status: "DRAFT" };

  it("SEO_MANAGER can see the product list but not the editor", () => {
    assert.equal(hasPermission("SEO_MANAGER", "products:view"), true);
    assert.equal(hasPermission("SEO_MANAGER", "products:manage"), false);
  });

  it("SEO_MANAGER gets no editor link: the name is plain text and a live product offers a storefront View link", () => {
    const links = productRowLinks(liveProduct, hasPermission("SEO_MANAGER", "products:manage"));
    assert.equal(links.nameHref, null);
    assert.deepEqual(links.action, { label: "View", href: "/products/classic-scrub-top", external: true });
  });

  it("SEO_MANAGER gets no link at all for a draft product (it has no public page to open)", () => {
    const links = productRowLinks(draftProduct, hasPermission("SEO_MANAGER", "products:manage"));
    assert.equal(links.nameHref, null);
    assert.equal(links.action, null);
  });

  it("a role with products:manage gets the editor on the name and an Edit action", () => {
    const links = productRowLinks(liveProduct, hasPermission("CATALOG_MANAGER", "products:manage"));
    assert.equal(links.nameHref, `/admin/products/${liveProduct.id}`);
    assert.deepEqual(links.action, { label: "Edit", href: `/admin/products/${liveProduct.id}`, external: false });
  });

  it("no role is ever linked to an admin product page it can't open", () => {
    for (const role of adminRoles) {
      if (!hasPermission(role, "products:view")) continue;
      const canManage = hasPermission(role, "products:manage");
      for (const product of [liveProduct, draftProduct]) {
        const links = productRowLinks(product, canManage);
        const hrefs = [links.nameHref, links.action?.href].filter((href): href is string => Boolean(href));
        for (const href of hrefs) {
          if (href.startsWith("/admin/products/")) {
            assert.equal(canManage, true, `${role} was linked to ${href} without products:manage`);
          }
        }
      }
    }
  });
});

// F-292: /admin/media is open to media:manage, but POST /api/admin/media/
// generate needs ai:generate. The "Generate with AI" button is gated on the
// second permission, so the mismatch below is exactly the case it exists for.
describe("site image generation permission (F-292)", () => {
  it("CONTENT_EDITOR can manage media but not generate AI images", () => {
    assert.equal(hasPermission("CONTENT_EDITOR", "media:manage"), true);
    assert.equal(hasPermission("CONTENT_EDITOR", "ai:generate"), false);
  });

  it("CATALOG_MANAGER can both manage media and generate AI images", () => {
    assert.equal(hasPermission("CATALOG_MANAGER", "media:manage"), true);
    assert.equal(hasPermission("CATALOG_MANAGER", "ai:generate"), true);
  });
});
