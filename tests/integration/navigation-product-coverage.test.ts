import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { db } from "@/lib/db";
import { draftCategories } from "@/data/catalog/draft-catalog";
import { getNavigation } from "@/lib/navigation/get-navigation";
import { getCategoryTree, getProducts, type CategoryTreeNode } from "@/lib/products";

describe("navigation category product coverage", () => {
  // A freshly seeded database has the whole launch catalogue in DRAFT (the
  // owner publishes it from the admin), so publish the seeded launch products
  // for this test and put them back afterwards.
  const launchSlugs = new Set(draftCategories.map((category) => category.slug));
  let publishedForTest: string[] = [];

  before(async () => {
    const drafts = await db.product.findMany({
      where: { status: "DRAFT", category: { slug: { in: [...launchSlugs] } } },
      select: { id: true },
    });
    publishedForTest = drafts.map((product) => product.id);
    await db.product.updateMany({ where: { id: { in: publishedForTest } }, data: { status: "ACTIVE" } });
  });

  after(async () => {
    await db.product.updateMany({ where: { id: { in: publishedForTest } }, data: { status: "DRAFT" } });
  });

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
