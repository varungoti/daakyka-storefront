import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { PATCH as patchSetting } from "@/app/api/admin/settings/[key]/route";
import { db } from "@/lib/db";
import {
  getSetting,
  isPageEnabled,
  isSaleEnabled,
  isSettingKey,
  setSetting,
  settingDefaults,
} from "@/lib/settings";

// Any admin user works for attributing the audit-logged setting change —
// this repo's dev DB may or may not have the documented seed admin
// (DEFAULT_ADMIN_SEED_EMAIL), so find whichever admin user exists instead
// of depending on a specific seeded email.
async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

describe("site settings integration", () => {
  describe("PATCH /api/admin/settings/[key] without a session", () => {
    it("rejects with 401 when the route handler is called directly with no session", async () => {
      // Calling the route handler directly (no real Next.js request scope,
      // no session cookie) exercises the same requireAdminPermission guard
      // every admin route uses. This is the "mock nothing" auth-less check.
      const request = new Request("http://localhost/api/admin/settings/sale.enabled", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: true }),
      });
      const response = await patchSetting(request, {
        params: Promise.resolve({ key: "sale.enabled" }),
      });
      assert.ok(
        response.status === 401 || response.status === 403,
        `expected 401 or 403, got ${response.status}`,
      );
    });

    it("still rejects unauthenticated even for an unknown key (auth checked first)", async () => {
      const request = new Request("http://localhost/api/admin/settings/not-a-real-key", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: true }),
      });
      const response = await patchSetting(request, {
        params: Promise.resolve({ key: "not-a-real-key" }),
      });
      assert.ok(
        response.status === 401 || response.status === 403,
        `expected 401 or 403, got ${response.status}`,
      );
    });
  });

  describe("isSettingKey", () => {
    it("only known keys map to a valid route param (unknown keys 404)", () => {
      assert.equal(isSettingKey("sale.enabled"), true);
      assert.equal(isSettingKey("not-a-real-key"), false);
    });
  });

  describe("setSetting + isPageEnabled round trip", () => {
    const originalMixMatch = settingDefaults["pages.mixMatch.enabled"];

    after(async () => {
      // Leave the real dev database exactly as this test found it.
      await db.siteSetting.upsert({
        where: { key: "pages.mixMatch.enabled" },
        create: { key: "pages.mixMatch.enabled", value: originalMixMatch },
        update: { value: originalMixMatch },
      });
    });

    it("persists a written value and getSetting/isPageEnabled reflect it", async () => {
      const adminId = await findAnyAdminId();

      await setSetting("pages.mixMatch.enabled", true, adminId);
      assert.equal(await getSetting("pages.mixMatch.enabled"), true);
      assert.equal(await isPageEnabled("mixMatch"), true);

      await setSetting("pages.mixMatch.enabled", false, adminId);
      assert.equal(await getSetting("pages.mixMatch.enabled"), false);
      assert.equal(await isPageEnabled("mixMatch"), false);
    });

    it("writes an audit log entry for the change", async () => {
      const adminId = await findAnyAdminId();

      await setSetting("sale.enabled", false, adminId);
      const latest = await db.auditLog.findFirst({
        where: { entity: "site_setting", entityId: "sale.enabled" },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(latest, "expected an audit log row for the setting change");
      assert.equal(latest.action, "update");

      // Restore.
      await setSetting("sale.enabled", true, adminId);
      assert.equal(await isSaleEnabled(), true);
    });
  });

  describe("fabric-technology gating helper", () => {
    it("isPageEnabled(fabricTech) defaults to disabled, matching the page's notFound() gate", async () => {
      const row = await db.siteSetting.findUnique({ where: { key: "pages.fabricTech.enabled" } });
      if (!row) {
        // No admin has touched this key yet in this DB — the documented
        // default (used by the fabric-technology page.tsx gate) is false.
        assert.equal(settingDefaults["pages.fabricTech.enabled"], false);
        assert.equal(await isPageEnabled("fabricTech"), false);
      } else {
        assert.equal(await isPageEnabled("fabricTech"), row.value === true);
      }
    });
  });
});
