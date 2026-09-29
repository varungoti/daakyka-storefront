import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { db } from "@/lib/db";
import { draftCategories } from "@/data/catalog/draft-catalog";
import { getNavigation } from "@/lib/navigation/get-navigation";
import { getCategoryTree, getProducts, type CategoryTreeNode } from "@/lib/products";

describe("navigation category product coverage", () => {
  it("serves all published products from every category link in the menu", async () => {
    const navigation = await getNavigation();
    const tree = await getCategoryTree();
    const nodes = new Map<string, CategoryTreeNode>();
    const visit = (node: CategoryTreeNode) => {
      nodes.set(node.slug, node);
      node.children.forEach(visit);
    };
    tree.forEach(visit);

    const hrefs = new Set<string>();
    for (const item of navigation.items) {
      if (item.kind === "mega-grid") {
        for (const tile of item.tiles) {
          hrefs.add(tile.href);
          tile.children.forEach((child) => hrefs.add(child.href));
        }
      } else if (item.kind === "mega-columns") {
        item.columns.forEach((column) => column.items.forEach((link) => hrefs.add(link.href)));
      } else if (item.kind === "simple") {
        item.children.forEach((link) => hrefs.add(link.href));
      }
    }

    // Other integration files create temporary visible categories while this
    // file runs. Restrict the assertion to the seeded launch catalog.
    const launchSlugs = new Set(draftCategories.map((category) => category.slug));
    const launchHrefs = [...hrefs].filter((href) => launchSlugs.has(href.split("/").at(-1)!));
    assert.ok(launchHrefs.length > 20);
    const descendantSlugs = (node: CategoryTreeNode): string[] =>
      [node.slug, ...node.children.flatMap(descendantSlugs)];
    for (const href of launchHrefs) {
      const slug = href.split("/").at(-1)!;
      const node = nodes.get(slug);
      assert.ok(node, `${href} must resolve to an active category`);
      const expected = await db.product.count({
        where: { status: "ACTIVE", category: { slug: { in: descendantSlugs(node) }, active: true } },
      });
      assert.ok(expected > 0, `${href} must have published products`);
      assert.equal((await getProducts({ categorySlug: slug })).length, expected, `${href} must show every published product`);
    }
  });
});
