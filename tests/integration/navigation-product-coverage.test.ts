import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { db } from "@/lib/db";
import { getNavigation } from "@/lib/navigation/get-navigation";
import { getCategoryTree, getProducts, type CategoryTreeNode } from "@/lib/products";
import { seedCatalog } from "../../prisma/seed-catalog";

describe("navigation category product coverage", () => {
  before(async () => { await seedCatalog(db, { publish: true }); });

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

    assert.ok(hrefs.size > 20);
    const descendantSlugs = (node: CategoryTreeNode): string[] =>
      [node.slug, ...node.children.flatMap(descendantSlugs)];
    for (const href of hrefs) {
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
