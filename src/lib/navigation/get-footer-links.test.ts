import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFooterLinks } from "@/lib/navigation/build-footer-links";

/**
 * Unit tests for the pure footer link-building logic (Phase C6), mirroring
 * get-navigation.test.ts's approach so this doesn't need a database.
 * buildFooterLinks() lives in build-footer-links.ts (kept free of any
 * server-only imports so it's safe to call from the client-rendered
 * <Footer>) — see get-footer-links.ts's getFooterLinks() for the thin
 * DB-reading wrapper around it, and tests/integration/get-footer-links.test.ts
 * for the DB-backed round trip.
 */

describe("buildFooterLinks", () => {
  it("always includes the core Shop links", () => {
    const links = buildFooterLinks({
      fabricTechEnabled: false,
      mixMatchEnabled: false,
      saleEnabled: false,
    });
    const hrefs = links.shop.links.map((link) => link.href);
    assert.deepEqual(hrefs, ["/shop", "/for-hospitals", "/school-uniforms", "/kids-wear"]);
  });

  it("adds Sale to the Shop column only when saleEnabled is true", () => {
    const disabled = buildFooterLinks({
      fabricTechEnabled: false,
      mixMatchEnabled: false,
      saleEnabled: false,
    });
    assert.ok(!disabled.shop.links.some((link) => link.href === "/sale"));

    const enabled = buildFooterLinks({
      fabricTechEnabled: false,
      mixMatchEnabled: false,
      saleEnabled: true,
    });
    assert.ok(enabled.shop.links.some((link) => link.href === "/sale"));
  });

  it("always includes the full Help column", () => {
    const links = buildFooterLinks({
      fabricTechEnabled: false,
      mixMatchEnabled: false,
      saleEnabled: false,
    });
    const hrefs = links.help.links.map((link) => link.href);
    assert.deepEqual(hrefs, ["/size-guide", "/shipping", "/returns", "/contact", "/bulk-orders"]);
  });

  it("omits Fabric Tech and Mix & Match from Company when both are disabled", () => {
    const links = buildFooterLinks({
      fabricTechEnabled: false,
      mixMatchEnabled: false,
      saleEnabled: false,
    });
    assert.ok(!links.company.links.some((link) => link.href === "/fabric-technology"));
    assert.ok(!links.company.links.some((link) => link.href === "/mix-and-match"));
  });

  it("includes Fabric Tech in Company only when enabled", () => {
    const links = buildFooterLinks({
      fabricTechEnabled: true,
      mixMatchEnabled: false,
      saleEnabled: false,
    });
    assert.ok(links.company.links.some((link) => link.href === "/fabric-technology"));
    assert.ok(!links.company.links.some((link) => link.href === "/mix-and-match"));
  });

  it("includes Mix & Match in Company only when enabled", () => {
    const links = buildFooterLinks({
      fabricTechEnabled: false,
      mixMatchEnabled: true,
      saleEnabled: false,
    });
    assert.ok(!links.company.links.some((link) => link.href === "/fabric-technology"));
    assert.ok(links.company.links.some((link) => link.href === "/mix-and-match"));
  });

  it("includes both Fabric Tech and Mix & Match in Company when both are enabled", () => {
    const links = buildFooterLinks({
      fabricTechEnabled: true,
      mixMatchEnabled: true,
      saleEnabled: true,
    });
    assert.ok(links.company.links.some((link) => link.href === "/fabric-technology"));
    assert.ok(links.company.links.some((link) => link.href === "/mix-and-match"));
  });
});
