import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canViewEmailOutbox,
  canViewJourneyLog,
  canViewNotificationsPage,
} from "@/lib/admin/notifications-access";

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
