import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { getFooterLinks } from "@/lib/navigation/get-footer-links";
import { setSetting, settingDefaults } from "@/lib/settings";

/**
 * Phase C6: the footer's DB-backed getFooterLinks() reflects the live
 * Fabric Tech / Mix & Match / Sale SiteSetting toggles — the same
 * settings the admin site-controls page writes via setSetting(). See
 * src/lib/navigation/get-footer-links.test.ts for the pure builder-function
 * unit tests that don't need a database.
 */

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

describe("getFooterLinks integration", () => {
  const originalFabricTech = settingDefaults["pages.fabricTech.enabled"];
  const originalMixMatch = settingDefaults["pages.mixMatch.enabled"];
  const originalSale = settingDefaults["sale.enabled"];

  after(async () => {
    // Leave the real dev database exactly as this test found it.
    await db.siteSetting.upsert({
      where: { key: "pages.fabricTech.enabled" },
      create: { key: "pages.fabricTech.enabled", value: originalFabricTech },
      update: { value: originalFabricTech },
    });
    await db.siteSetting.upsert({
      where: { key: "pages.mixMatch.enabled" },
      create: { key: "pages.mixMatch.enabled", value: originalMixMatch },
      update: { value: originalMixMatch },
    });
    await db.siteSetting.upsert({
      where: { key: "sale.enabled" },
      create: { key: "sale.enabled", value: originalSale },
      update: { value: originalSale },
    });
  });

  it("omits Fabric Tech and Mix & Match footer links when both settings are disabled", async () => {
    const adminId = await findAnyAdminId();
    await setSetting("pages.fabricTech.enabled", false, adminId);
    await setSetting("pages.mixMatch.enabled", false, adminId);

    const links = await getFooterLinks();
    assert.ok(!links.company.links.some((link) => link.href === "/fabric-technology"));
    assert.ok(!links.company.links.some((link) => link.href === "/mix-and-match"));
  });

  it("includes Fabric Tech and Mix & Match footer links once the settings are enabled", async () => {
    const adminId = await findAnyAdminId();
    await setSetting("pages.fabricTech.enabled", true, adminId);
    await setSetting("pages.mixMatch.enabled", true, adminId);

    const links = await getFooterLinks();
    assert.ok(links.company.links.some((link) => link.href === "/fabric-technology"));
    assert.ok(links.company.links.some((link) => link.href === "/mix-and-match"));
  });

  it("removes the Sale footer link when sale.enabled is toggled off", async () => {
    const adminId = await findAnyAdminId();
    await setSetting("sale.enabled", false, adminId);

    const links = await getFooterLinks();
    assert.ok(!links.shop.links.some((link) => link.href === "/sale"));

    await setSetting("sale.enabled", true, adminId);
    const enabledLinks = await getFooterLinks();
    assert.ok(enabledLinks.shop.links.some((link) => link.href === "/sale"));
  });
});
