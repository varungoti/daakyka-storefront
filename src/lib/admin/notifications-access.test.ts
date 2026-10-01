import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canViewEmailOutbox,
  canViewJourneyLog,
  canViewNotificationsPage,
} from "@/lib/admin/notifications-access";
import { resolveNotificationLink } from "@/lib/admin/notification-links";

describe("notifications page access (F-268)", () => {
  it("MARKETING_ADMIN can open the page and see the journey log, but not the email outbox", () => {
    assert.equal(canViewNotificationsPage("MARKETING_ADMIN"), true);
    assert.equal(canViewJourneyLog("MARKETING_ADMIN"), true);
    assert.equal(canViewEmailOutbox("MARKETING_ADMIN"), false);
  });

  it("BULK_ORDER_MANAGER can open the page, but sees neither the email outbox nor the journey log", () => {
    assert.equal(canViewNotificationsPage("BULK_ORDER_MANAGER"), true);
    assert.equal(canViewEmailOutbox("BULK_ORDER_MANAGER"), false);
    assert.equal(canViewJourneyLog("BULK_ORDER_MANAGER"), false);
  });

  it("ORDER_MANAGER (orders:view) sees the email outbox", () => {
    assert.equal(canViewEmailOutbox("ORDER_MANAGER"), true);
  });

  it("SUPPORT_AGENT (orders:view + customers:view) sees the email outbox", () => {
    assert.equal(canViewEmailOutbox("SUPPORT_AGENT"), true);
  });

  it("VIEWER cannot open the page at all", () => {
    assert.equal(canViewNotificationsPage("VIEWER"), false);
  });

  it("CATALOG_MANAGER cannot open the page at all", () => {
    assert.equal(canViewNotificationsPage("CATALOG_MANAGER"), false);
  });

  it("SUPER_ADMIN sees every section", () => {
    assert.equal(canViewNotificationsPage("SUPER_ADMIN"), true);
    assert.equal(canViewEmailOutbox("SUPER_ADMIN"), true);
    assert.equal(canViewJourneyLog("SUPER_ADMIN"), true);
  });
});

// F-168: "New order DK-…" notifications were plain text even though their
// metadata carries the order number — and a link is only useful if the
// viewing role can actually open where it points.
describe("notification links (F-168)", () => {
  const orderMeta = JSON.stringify({ orderNumber: "DK-2026-5531403910", email: "a@b.com", total: 4999 });

  it("links a new-order alert to that order for a role that can view orders", () => {
    for (const type of ["order_paid", "order_request"]) {
      assert.deepEqual(resolveNotificationLink("ORDER_MANAGER", type, orderMeta), {
        href: "/admin/orders?q=DK-2026-5531403910",
        label: "View order",
      });
    }
  });

  it("gives no order link to a role that can't open /admin/orders", () => {
    assert.equal(resolveNotificationLink("BULK_ORDER_MANAGER", "order_paid", orderMeta), null);
    assert.equal(resolveNotificationLink("MARKETING_ADMIN", "order_request", orderMeta), null);
  });

  it("gives no link when the metadata is missing, malformed or lacks the order number", () => {
    assert.equal(resolveNotificationLink("SUPER_ADMIN", "order_paid", null), null);
    assert.equal(resolveNotificationLink("SUPER_ADMIN", "order_paid", "not json"), null);
    assert.equal(resolveNotificationLink("SUPER_ADMIN", "order_paid", JSON.stringify({ total: 5 })), null);
    assert.equal(resolveNotificationLink("SUPER_ADMIN", "order_paid", JSON.stringify([1, 2])), null);
  });

  it("encodes the order number into the query string", () => {
    const link = resolveNotificationLink("SUPER_ADMIN", "order_paid", JSON.stringify({ orderNumber: "A B&c=d" }));
    assert.equal(link?.href, "/admin/orders?q=A%20B%26c%3Dd");
  });

  it("links enquiries to their inbox for roles that manage them", () => {
    assert.equal(resolveNotificationLink("BULK_ORDER_MANAGER", "contact_enquiry", "{}")?.href, "/admin/contact-enquiries");
    assert.equal(resolveNotificationLink("BULK_ORDER_MANAGER", "bulk_lead", "{}")?.href, "/admin/bulk-orders");
    assert.equal(resolveNotificationLink("VIEWER", "contact_enquiry", "{}"), null);
  });

  it("links campaign alerts to the campaign, only for engagement managers, and only for an id-shaped value", () => {
    const meta = JSON.stringify({ campaignId: "cmcamp0000000000000000001" });
    assert.equal(resolveNotificationLink("MARKETING_ADMIN", "campaign_dispatch", meta)?.href, "/admin/campaigns/cmcamp0000000000000000001");
    assert.equal(resolveNotificationLink("ORDER_MANAGER", "campaign_dispatch", meta), null);
    assert.equal(
      resolveNotificationLink("MARKETING_ADMIN", "campaign_dispatch_error", JSON.stringify({ campaignId: "../../x" })),
      null,
    );
  });

  it("has no link for a type it doesn't know — including Object.prototype names", () => {
    assert.equal(resolveNotificationLink("SUPER_ADMIN", "journey_step_whatever", "{}"), null);
    assert.equal(resolveNotificationLink("SUPER_ADMIN", "constructor", "{}"), null);
    assert.equal(resolveNotificationLink("SUPER_ADMIN", "__proto__", "{}"), null);
  });
});
