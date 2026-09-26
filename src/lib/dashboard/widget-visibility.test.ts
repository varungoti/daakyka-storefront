import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adminRoles, hasPermission } from "@/lib/auth/rbac";
import { getDashboardWidgetVisibility } from "@/lib/dashboard/widget-visibility";

describe("getDashboardWidgetVisibility (F-161)", () => {
  it("never shows a widget to a role that lacks the target page's own permission", () => {
    const targetPermission = {
      leads: "bulk-orders:manage",
      subscribers: "engagement:manage",
      blog: "blog:manage",
      campaigns: "engagement:manage",
      hermes: "hermes:manage",
      products: "products:view",
      orders: "orders:view",
      reviews: "reviews:moderate",
      audit: "audit:view",
    } as const;

    for (const role of adminRoles) {
      const visibility = getDashboardWidgetVisibility(role);
      for (const [widget, permission] of Object.entries(targetPermission)) {
        assert.equal(
          visibility[widget as keyof typeof visibility],
          hasPermission(role, permission),
          `${role} / ${widget} should match hasPermission(role, "${permission}")`,
        );
      }
    }
  });

  it("CONTENT_EDITOR (no orders/leads/audit access) does not see orders, leads or audit widgets", () => {
    const visibility = getDashboardWidgetVisibility("CONTENT_EDITOR");
    assert.equal(visibility.orders, false);
    assert.equal(visibility.leads, false);
    assert.equal(visibility.audit, false);
    assert.equal(visibility.products, false);
    // CONTENT_EDITOR does have blog:manage.
    assert.equal(visibility.blog, true);
  });

  it("VIEWER sees only the audit widget, not orders/leads/products", () => {
    const visibility = getDashboardWidgetVisibility("VIEWER");
    assert.equal(visibility.audit, true);
    assert.equal(visibility.orders, false);
    assert.equal(visibility.leads, false);
    assert.equal(visibility.products, false);
  });

  it("BULK_ORDER_MANAGER sees only the leads widget", () => {
    const visibility = getDashboardWidgetVisibility("BULK_ORDER_MANAGER");
    assert.equal(visibility.leads, true);
    assert.equal(visibility.orders, false);
    assert.equal(visibility.audit, false);
    assert.equal(visibility.products, false);
  });

  it("every role sees at least one widget (no role lands on a fully blank dashboard)", () => {
    for (const role of adminRoles) {
      const visibility = getDashboardWidgetVisibility(role);
      assert.ok(
        Object.values(visibility).some(Boolean),
        `${role} sees no dashboard widgets at all`,
      );
    }
  });
});
