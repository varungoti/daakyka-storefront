import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasPermission } from "@/lib/auth/rbac";
import { settingPermissions } from "@/lib/settings/permissions";

/**
 * F-061: settingPermissions is the enforcement point for MARKETING_ADMIN's
 * documented "sale/announcement settings only" scope — this pins exactly
 * which keys are marketing-scoped vs store-owner-only, and that the role
 * matrix actually agrees with it (belt-and-suspenders alongside
 * src/lib/auth/rbac.test.ts's MARKETING_ADMIN case).
 *
 * Deliberately doesn't import anything from "@/lib/settings" (which pulls
 * in the Prisma client and needs a real DATABASE_URL just to import, see
 * src/lib/create-prisma-client.ts) — settingPermissions itself only takes a
 * type-only import from there, and this test keeps that property so it can
 * run with no DB at all.
 */
describe("settingPermissions (F-061)", () => {
  const marketingKeys = ["sale.enabled", "announcement.messages", "header.bulkCta.enabled"] as const;
  const storeOnlyKeys = [
    "pages.fabricTech.enabled",
    "pages.mixMatch.enabled",
    "shipping.flatRate",
    "shipping.freeAbove",
    "contact.phone",
    "contact.whatsapp",
    "contact.email",
    "contact.address",
  ] as const;

  it("maps the sale banner, announcement bar, and header CTA to settings:marketing", () => {
    for (const key of marketingKeys) {
      assert.equal(settingPermissions[key], "settings:marketing", `${key} should be settings:marketing`);
    }
  });

  it("maps shipping, contact, and page-visibility keys to settings:manage", () => {
    for (const key of storeOnlyKeys) {
      assert.equal(settingPermissions[key], "settings:manage", `${key} should be settings:manage`);
    }
  });

  it("declares every key this test knows about (other packages may add more store-owner-level keys)", () => {
    const declared = new Set(Object.keys(settingPermissions));
    for (const key of [...marketingKeys, ...storeOnlyKeys]) {
      assert.ok(declared.has(key), `settingPermissions is missing an entry for ${key}`);
    }
  });

  it("only sale.enabled, announcement.messages, and header.bulkCta.enabled are marketing-scoped", () => {
    // The inverse of the two checks above: nothing outside this exact list
    // should be reachable with just "settings:marketing" — a future key
    // added here with no explicit thought defaults to "settings:manage"
    // (TypeScript's Record<SettingKey, Permission> forces *some* entry, but
    // not which one), so this guards against silently widening
    // MARKETING_ADMIN's scope again.
    const marketingScoped = Object.entries(settingPermissions)
      .filter(([, permission]) => permission === "settings:marketing")
      .map(([key]) => key)
      .sort();
    assert.deepEqual(marketingScoped, [...marketingKeys].sort());
  });

  it("MARKETING_ADMIN can write marketing keys but not store-only keys", () => {
    for (const key of marketingKeys) {
      assert.equal(hasPermission("MARKETING_ADMIN", settingPermissions[key]), true, key);
    }
    for (const key of storeOnlyKeys) {
      assert.equal(hasPermission("MARKETING_ADMIN", settingPermissions[key]), false, key);
    }
  });

  it("SUPER_ADMIN and STORE_OWNER can write every key", () => {
    for (const key of [...marketingKeys, ...storeOnlyKeys]) {
      assert.equal(hasPermission("SUPER_ADMIN", settingPermissions[key]), true, key);
      assert.equal(hasPermission("STORE_OWNER", settingPermissions[key]), true, key);
    }
  });

  it("a role with neither settings permission (e.g. SEO_MANAGER) can write none of these keys", () => {
    for (const key of [...marketingKeys, ...storeOnlyKeys]) {
      assert.equal(hasPermission("SEO_MANAGER", settingPermissions[key]), false, key);
    }
  });
});
