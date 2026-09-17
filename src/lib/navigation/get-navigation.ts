import { getCategoryTree, type CategoryTreeNode } from "@/lib/products";
import { isSaleEnabled } from "@/lib/settings";

/**
 * Phase C2: the header's nav tree, built from the DB category tree
 * (Phase B3's getCategoryTree()) plus SiteSetting flags (Phase A5). The
 * header component (client, for hover/focus interactivity) receives this
 * as a prop from a server parent instead of querying the DB itself — see
 * src/components/layout/header-server.tsx.
 *
 * Fabric Tech and Mix & Match are intentionally never included here (per
 * the plan, they only ever appear in the footer, gated by
 * isPageEnabled()).
 */

export interface NavLink {
  label: string;
  href: string;
}

export interface NavImage {
  url: string;
  alt: string;
}

export interface NavCategoryTile extends NavLink {
  image: NavImage | null;
  children: NavLink[];
}

export interface NavColumn {
  heading: string;
  items: NavLink[];
}

export type NavItem =
  | { id: string; kind: "link"; label: string; href: string }
  | { id: string; kind: "simple"; label: string; href: string; children: NavLink[] }
  | { id: string; kind: "mega-grid"; label: string; href: string; tiles: NavCategoryTile[] }
  | {
      id: string;
      kind: "mega-columns";
      label: string;
      href: string;
      columns: NavColumn[];
      promo?: NavLink;
    };

export interface NavigationTree {
  items: NavItem[];
}

// Slugs from the Phase E1 draft catalog seed (src/data/catalog/draft-catalog.ts).
// If these categories don't exist yet (e.g. a fresh DB before seeding),
// the corresponding menu entries are simply omitted below rather than
// guessed at — a partial menu is safer than a broken one.
const HOSPITALS_SLUG = "for-hospitals";
const HOSPITAL_LINENS_SLUG = "hospital-linens";
const SCHOOL_SLUG = "school-uniforms";
const KIDS_SLUG = "kids-wear";

function toNavLink(node: CategoryTreeNode): NavLink {
  return { label: node.name, href: `/category/${node.slug}` };
}

function toCategoryTile(node: CategoryTreeNode): NavCategoryTile {
  return {
    label: node.name,
    href: `/category/${node.slug}`,
    image: node.image ? { url: node.image.url, alt: node.image.alt ?? node.name } : null,
    children: node.children.filter((child) => child.showInMenu).map(toNavLink),
  };
}

/**
 * Pure tree-building logic, kept separate from the DB/settings reads in
 * getNavigation() below so it can be unit tested against a hand-built
 * category tree instead of a real database (see get-navigation.test.ts).
 */
export function buildNavigationFromTree(
  tree: CategoryTreeNode[],
  flags: { saleEnabled: boolean },
): NavigationTree {
  const items: NavItem[] = [];
  const menuCategories = tree.filter((category) => category.showInMenu);

  // "Shop" — a mega grid of every active top-level category with
  // showInMenu, each tile carrying its own children as quick links. This
  // is the general "browse everything" entry point.
  items.push({
    id: "shop",
    kind: "mega-grid",
    label: "Shop",
    href: "/shop",
    tiles: menuCategories.map(toCategoryTile),
  });

  const hospitals = tree.find((category) => category.slug === HOSPITALS_SLUG);
  if (hospitals) {
    const linens = hospitals.children.find((child) => child.slug === HOSPITAL_LINENS_SLUG);
    const apparel = hospitals.children.filter((child) => child.slug !== HOSPITAL_LINENS_SLUG);
    items.push({
      id: "for-hospitals",
      kind: "mega-columns",
      label: "For Hospitals",
      href: "/for-hospitals",
      columns: [
        { heading: "Apparel", items: apparel.map(toNavLink) },
        { heading: "Linens", items: (linens?.children ?? []).map(toNavLink) },
      ],
      promo: { label: "Bulk hospital orders →", href: "/bulk-orders" },
    });
  }

  const school = tree.find((category) => category.slug === SCHOOL_SLUG);
  if (school) {
    items.push({
      id: "school-uniforms",
      kind: "mega-columns",
      label: "School Uniforms",
      href: "/school-uniforms",
      columns: [{ heading: "Shop by Type", items: school.children.map(toNavLink) }],
      promo: { label: "School bulk orders →", href: "/bulk-orders" },
    });
  }

  const kids = tree.find((category) => category.slug === KIDS_SLUG);
  if (kids) {
    items.push({
      id: "kids-wear",
      kind: "simple",
      label: "Kids Wear",
      href: "/kids-wear",
      children: kids.children.map(toNavLink),
    });
  }

  if (flags.saleEnabled) {
    items.push({ id: "sale", kind: "link", label: "Sale", href: "/sale" });
  }

  items.push({ id: "size-guide", kind: "link", label: "Size Guide", href: "/size-guide" });
  items.push({ id: "about", kind: "link", label: "About", href: "/about" });
  items.push({ id: "contact", kind: "link", label: "Contact", href: "/contact" });

  return { items };
}

export async function getNavigation(): Promise<NavigationTree> {
  const [tree, saleEnabled] = await Promise.all([getCategoryTree(), isSaleEnabled()]);
  return buildNavigationFromTree(tree, { saleEnabled });
}
