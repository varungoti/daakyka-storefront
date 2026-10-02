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
  StaleSettingError,
} from "@/lib/settings";
import { findAnyAdminId } from "../helpers/admin-user";

// The audit-logged setting change just needs *an* acting admin id, but it
// has to be one that still exists when the write lands: see
// tests/helpers/admin-user.ts for why "whichever user comes back first"
// raced with the files that create and delete their own admins. The helper
// keys on the SUPER_ADMIN role rather than a specific seeded email, so it
// still doesn't depend on DEFAULT_ADMIN_SEED_EMAIL being the local value.

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

    // F-288: the row used to hold only the new value.
    it("records the value a setting had before, not just the one it was changed to (F-288)", async () => {
      const adminId = await findAnyAdminId();

      await setSetting("sale.enabled", true, adminId);
      await setSetting("sale.enabled", false, adminId);
      const latest = await db.auditLog.findFirst({
        where: { entity: "site_setting", entityId: "sale.enabled" },
        orderBy: { createdAt: "desc" },
      });
      const metadata = JSON.parse(latest!.metadata!) as { value: unknown; previousValue: unknown };
      assert.equal(metadata.value, false);
      assert.equal(metadata.previousValue, true);

      await setSetting("sale.enabled", true, adminId);
    });
  });

  // F-343: setSetting used to `upsert` unconditionally — two admins saving
  // the same key around the same time both got a 200, and whichever write
  // committed last silently discarded the other's edit.
  describe("setSetting optimistic concurrency guard (F-343)", () => {
    // Uses a key no other integration file reads: the suite runs files in
    // parallel against one DB, and routing/get-footer-links assert on the
    // pages.* flags, so toggling those here raced with them.
    const originalBulkCta = settingDefaults["header.bulkCta.enabled"];

    after(async () => {
      await db.siteSetting.upsert({
        where: { key: "header.bulkCta.enabled" },
        create: { key: "header.bulkCta.enabled", value: originalBulkCta },
        update: { value: originalBulkCta },
      });
    });

    it("writes unconditionally (unchanged behavior) when expectedUpdatedAt is omitted", async () => {
      const adminId = await findAnyAdminId();
      await setSetting("header.bulkCta.enabled", true, adminId);
      await setSetting("header.bulkCta.enabled", false, adminId);
      assert.equal(await getSetting("header.bulkCta.enabled"), false);
    });

    it("throws StaleSettingError when expectedUpdatedAt no longer matches the stored row", async () => {
      const adminId = await findAnyAdminId();
      await setSetting("header.bulkCta.enabled", true, adminId);
      const loaded = await db.siteSetting.findUniqueOrThrow({ where: { key: "header.bulkCta.enabled" } });

      // Someone else saves the same key in between this admin loading it
      // and submitting their own edit.
      await setSetting("header.bulkCta.enabled", false, adminId);

      await assert.rejects(
        () => setSetting("header.bulkCta.enabled", true, adminId, loaded.updatedAt),
        StaleSettingError,
      );
      // The "someone else"'s write must survive — the stale write above
      // must not have gone through.
      assert.equal(await getSetting("header.bulkCta.enabled"), false);
    });

    it("succeeds when expectedUpdatedAt matches the row nobody else has touched since", async () => {
      const adminId = await findAnyAdminId();
      await setSetting("header.bulkCta.enabled", false, adminId);
      const loaded = await db.siteSetting.findUniqueOrThrow({ where: { key: "header.bulkCta.enabled" } });

      await setSetting("header.bulkCta.enabled", true, adminId, loaded.updatedAt);
      assert.equal(await getSetting("header.bulkCta.enabled"), true);
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
