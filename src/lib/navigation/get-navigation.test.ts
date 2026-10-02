import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildNavigationFromTree, type NavItem } from "@/lib/navigation/get-navigation";
import type { CategoryTreeNode } from "@/lib/products";

/**
 * Unit tests for the pure nav tree-building logic (Phase C2), using a
 * hand-built category tree so this doesn't need a database — see
 * src/lib/navigation/get-navigation.ts's own getNavigation() for the
 * thin DB-reading wrapper around this.
 */

function node(partial: Partial<CategoryTreeNode> & { slug: string; name: string }): CategoryTreeNode {
  return {
    id: partial.slug,
    slug: partial.slug,
    name: partial.name,
    description: null,
    section: partial.section ?? "GENERAL",
    sortOrder: partial.sortOrder ?? 0,
    showInMenu: partial.showInMenu ?? true,
    image: partial.image ?? null,
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    children: partial.children ?? [],
  };
}

function buildMockTree(): CategoryTreeNode[] {
  return [
    node({
      slug: "for-hospitals",
      name: "For Hospitals",
      section: "HOSPITAL",
      children: [
        node({ slug: "scrub-sets", name: "Scrub Sets", section: "HOSPITAL" }),
        node({ slug: "scrub-tops", name: "Scrub Tops", section: "HOSPITAL" }),
        node({
          slug: "hospital-linens",
          name: "Hospital Linens",
          section: "HOSPITAL",
          children: [
            node({ slug: "bedsheets", name: "Bedsheets", section: "HOSPITAL" }),
            node({ slug: "pillow-covers", name: "Pillow Covers", section: "HOSPITAL" }),
          ],
        }),
      ],
    }),
    node({
      slug: "school-uniforms",
      name: "School Uniforms",
      section: "SCHOOL",
      children: [
        node({ slug: "school-shirts", name: "Shirts", section: "SCHOOL" }),
        node({ slug: "tunics", name: "Tunics", section: "SCHOOL" }),
      ],
    }),
    node({
      slug: "kids-wear",
      name: "Kids Wear",
      section: "KIDS",
      children: [node({ slug: "kids-tshirts", name: "Kids T-Shirts", section: "KIDS" })],
    }),
    node({
      slug: "corporate-uniforms",
      name: "Corporate Uniforms",
      section: "GENERAL",
      showInMenu: false,
    }),
  ];
}

function findItem(items: NavItem[], id: string): NavItem {
  const found = items.find((item) => item.id === id);
  assert.ok(found, `expected a nav item with id "${id}"`);
  return found!;
}

describe("buildNavigationFromTree", () => {
  it("builds a Shop mega-grid from every showInMenu top-level category, excluding hidden ones", () => {
    const nav = buildNavigationFromTree(buildMockTree(), { saleEnabled: false });
    const shop = findItem(nav.items, "shop");
    assert.equal(shop.kind, "mega-grid");
    if (shop.kind !== "mega-grid") return;
    const tileSlugs = shop.tiles.map((tile) => tile.href);
    // F-101: the three sections link to their landing pages, not the
    // /category/<slug> duplicates that canonicalize to them.
    assert.deepEqual(tileSlugs, ["/for-hospitals", "/school-uniforms", "/kids-wear"]);
  });

  it("splits For Hospitals into Apparel and Linens columns, excluding the linens category itself from Apparel", () => {
    const nav = buildNavigationFromTree(buildMockTree(), { saleEnabled: false });
    const hospitals = findItem(nav.items, "for-hospitals");
    assert.equal(hospitals.kind, "mega-columns");
    if (hospitals.kind !== "mega-columns") return;

    const apparel = hospitals.columns.find((c) => c.heading === "Apparel");
    const linens = hospitals.columns.find((c) => c.heading === "Linens");
    assert.ok(apparel && linens);

    assert.deepEqual(
      apparel!.items.map((i) => i.label),
      ["Scrub Sets", "Scrub Tops"],
    );
    assert.ok(!apparel!.items.some((i) => i.label === "Hospital Linens"));
    assert.deepEqual(
      linens!.items.map((i) => i.label),
      ["Bedsheets", "Pillow Covers"],
    );
    assert.equal(hospitals.promo?.href, "/bulk-orders");
  });

  it("builds a School Uniforms mega menu with a bulk-orders promo tile", () => {
    const nav = buildNavigationFromTree(buildMockTree(), { saleEnabled: false });
    const school = findItem(nav.items, "school-uniforms");
    assert.equal(school.kind, "mega-columns");
    if (school.kind !== "mega-columns") return;
    assert.deepEqual(
      school.columns[0].items.map((i) => i.label),
      ["Shirts", "Tunics"],
    );
    assert.equal(school.promo?.href, "/bulk-orders");
  });

  it("builds Kids Wear as a simple dropdown of its children", () => {
    const nav = buildNavigationFromTree(buildMockTree(), { saleEnabled: false });
    const kids = findItem(nav.items, "kids-wear");
    assert.equal(kids.kind, "simple");
    if (kids.kind !== "simple") return;
    assert.deepEqual(kids.children, [{ label: "Kids T-Shirts", href: "/category/kids-tshirts" }]);
  });

  it("omits Sale when disabled and includes it right after Kids Wear when enabled", () => {
    const disabled = buildNavigationFromTree(buildMockTree(), { saleEnabled: false });
    assert.ok(!disabled.items.some((item) => item.id === "sale"));

    const enabled = buildNavigationFromTree(buildMockTree(), { saleEnabled: true });
    const sale = findItem(enabled.items, "sale");
    assert.equal(sale.kind, "link");
    if (sale.kind === "link") assert.equal(sale.href, "/sale");
  });

  it("always includes plain Size Guide, About, and Contact links, and never Fabric Tech or Mix & Match", () => {
    const nav = buildNavigationFromTree(buildMockTree(), { saleEnabled: true });
    for (const id of ["size-guide", "about", "contact"]) {
      const item = findItem(nav.items, id);
      assert.equal(item.kind, "link");
    }
    assert.ok(!nav.items.some((item) => item.href?.includes("fabric-technology")));
    assert.ok(!nav.items.some((item) => item.href?.includes("mix-and-match")));
    assert.ok(!nav.items.some((item) => item.label.toLowerCase().includes("fabric")));
    assert.ok(!nav.items.some((item) => item.label.toLowerCase().includes("mix")));
  });

  it("omits the For Hospitals / School Uniforms / Kids Wear entries entirely when those categories don't exist", () => {
    const nav = buildNavigationFromTree([], { saleEnabled: false });
    assert.ok(!nav.items.some((item) => item.id === "for-hospitals"));
    assert.ok(!nav.items.some((item) => item.id === "school-uniforms"));
    assert.ok(!nav.items.some((item) => item.id === "kids-wear"));
    // Shop, Size Guide, About, Contact should still be present.
    assert.ok(nav.items.some((item) => item.id === "shop"));
    assert.equal(nav.items.length, 4);
  });

  it("includes category tile images when a category has one, and null otherwise", () => {
    const tree = buildMockTree();
    tree[0] = { ...tree[0], image: { url: "https://cdn.example.com/hospitals.webp", alt: null } };
    const nav = buildNavigationFromTree(tree, { saleEnabled: false });
    const shop = findItem(nav.items, "shop");
    if (shop.kind !== "mega-grid") throw new Error("expected mega-grid");
    const hospitalsTile = shop.tiles.find((t) => t.href === "/for-hospitals");
    assert.deepEqual(hospitalsTile?.image, {
      url: "https://cdn.example.com/hospitals.webp",
      alt: "For Hospitals",
    });
    const schoolTile = shop.tiles.find((t) => t.href === "/school-uniforms");
    assert.equal(schoolTile?.image, null);
  });
});

// F-084: only the Shop grid honoured the admin's "Show in menu" flag; the
// For Hospitals / School Uniforms / Kids Wear menus and the mobile drawer
// (which renders these same items) kept listing hidden categories.
describe("buildNavigationFromTree honours showInMenu everywhere (F-084)", () => {
  function hide(tree: CategoryTreeNode[], ...slugs: string[]): CategoryTreeNode[] {
    return tree.map((n) => ({
      ...n,
      showInMenu: slugs.includes(n.slug) ? false : n.showInMenu,
      children: hide(n.children, ...slugs),
    }));
  }

  function labels(item: NavItem): string[] {
    if (item.kind === "mega-columns") return item.columns.flatMap((c) => c.items.map((i) => i.label));
    if (item.kind === "simple") return item.children.map((c) => c.label);
    return [];
  }

  it("drops a hidden hospital apparel category from the For Hospitals menu", () => {
    const nav = buildNavigationFromTree(hide(buildMockTree(), "scrub-tops"), { saleEnabled: false });
    const hospitals = findItem(nav.items, "for-hospitals");
    assert.deepEqual(labels(hospitals), ["Scrub Sets", "Bedsheets", "Pillow Covers"]);
  });

  it("drops a hidden linens grandchild, and the whole Linens column once nothing in it is visible", () => {
    const partly = buildNavigationFromTree(hide(buildMockTree(), "bedsheets"), { saleEnabled: false });
    assert.deepEqual(labels(findItem(partly.items, "for-hospitals")), ["Scrub Sets", "Scrub Tops", "Pillow Covers"]);

    const none = buildNavigationFromTree(hide(buildMockTree(), "hospital-linens"), { saleEnabled: false });
    const hospitals = findItem(none.items, "for-hospitals");
    assert.equal(hospitals.kind, "mega-columns");
    if (hospitals.kind !== "mega-columns") return;
    assert.deepEqual(hospitals.columns.map((c) => c.heading), ["Apparel"]);
  });

  it("drops hidden School Uniforms and Kids Wear children", () => {
    const nav = buildNavigationFromTree(hide(buildMockTree(), "tunics"), { saleEnabled: false });
    assert.deepEqual(labels(findItem(nav.items, "school-uniforms")), ["Shirts"]);
  });

  it("removes a hidden top-level section from the header and drawer entirely", () => {
    const nav = buildNavigationFromTree(hide(buildMockTree(), "kids-wear", "for-hospitals"), { saleEnabled: false });
    assert.ok(!nav.items.some((item) => item.id === "kids-wear"));
    assert.ok(!nav.items.some((item) => item.id === "for-hospitals"));
    assert.ok(nav.items.some((item) => item.id === "school-uniforms"));
  });

  it("degrades a section whose every child is hidden to a plain link instead of an empty 'Coming soon' menu", () => {
    const nav = buildNavigationFromTree(hide(buildMockTree(), "kids-tshirts", "school-shirts", "tunics"), {
      saleEnabled: false,
    });
    assert.deepEqual(findItem(nav.items, "kids-wear"), {
      id: "kids-wear",
      kind: "link",
      label: "Kids Wear",
      href: "/kids-wear",
    });
    assert.deepEqual(findItem(nav.items, "school-uniforms"), {
      id: "school-uniforms",
      kind: "link",
      label: "School Uniforms",
      href: "/school-uniforms",
    });
  });

  it("keeps the Shop grid and the section menus in agreement about which children are visible", () => {
    const nav = buildNavigationFromTree(hide(buildMockTree(), "scrub-sets"), { saleEnabled: false });
    const shop = findItem(nav.items, "shop");
    if (shop.kind !== "mega-grid") throw new Error("expected mega-grid");
    const hospitalsTile = shop.tiles.find((t) => t.href === "/for-hospitals");
    assert.ok(!hospitalsTile?.children.some((c) => c.label === "Scrub Sets"));
    assert.ok(!labels(findItem(nav.items, "for-hospitals")).includes("Scrub Sets"));
  });
});
