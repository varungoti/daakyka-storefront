import { getCategoryTree, type CategoryTreeNode } from "@/lib/products";
import { sectionLandingPath } from "@/lib/seo/canonical";
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

/**
 * F-084: the admin's "Show in menu" flag has to hide a category from *every*
 * header/drawer menu, not only the Shop grid — getCategoryTree() returns
 * hidden categories too and leaves it to each menu renderer to filter.
 */
function visible(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  return nodes.filter((node) => node.showInMenu);
}

function toCategoryTile(node: CategoryTreeNode): NavCategoryTile {
  return {
    label: node.name,
    // release-hardening F-101: the three sections have a landing page (what
    // the top nav's own entries link to) that /category/<slug> merely
    // duplicates, and canonicalizes to — link straight to the landing page.
    href: sectionLandingPath(node.slug) ?? `/category/${node.slug}`,
    image: node.image ? { url: node.image.url, alt: node.image.alt ?? node.name } : null,
    children: visible(node.children).map(toNavLink),
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
  const menuCategories = visible(tree);

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

  // The section roots are looked up among the showInMenu categories only, so
  // hiding "Kids Wear" (say) drops its header entry and its mobile-drawer
  // entry too. A section whose every child is hidden degrades to a plain link
  // to its landing page rather than a menu of "Coming soon".
  const hospitals = menuCategories.find((category) => category.slug === HOSPITALS_SLUG);
  if (hospitals) {
    const hospitalChildren = visible(hospitals.children);
    const linens = hospitalChildren.find((child) => child.slug === HOSPITAL_LINENS_SLUG);
    const apparel = hospitalChildren.filter((child) => child.slug !== HOSPITAL_LINENS_SLUG);
    const columns: NavColumn[] = [
      { heading: "Apparel", items: apparel.map(toNavLink) },
      { heading: "Linens", items: visible(linens?.children ?? []).map(toNavLink) },
    ].filter((column) => column.items.length > 0);
    items.push(
      columns.length > 0
        ? {
            id: "for-hospitals",
            kind: "mega-columns",
            label: "For Hospitals",
            href: "/for-hospitals",
            columns,
            promo: { label: "Bulk hospital orders →", href: "/bulk-orders" },
          }
        : { id: "for-hospitals", kind: "link", label: "For Hospitals", href: "/for-hospitals" },
    );
  }

  const school = menuCategories.find((category) => category.slug === SCHOOL_SLUG);
  if (school) {
    const schoolLinks = visible(school.children).map(toNavLink);
    items.push(
      schoolLinks.length > 0
        ? {
            id: "school-uniforms",
            kind: "mega-columns",
            label: "School Uniforms",
            href: "/school-uniforms",
            columns: [{ heading: "Shop by Type", items: schoolLinks }],
            promo: { label: "School bulk orders →", href: "/bulk-orders" },
          }
        : { id: "school-uniforms", kind: "link", label: "School Uniforms", href: "/school-uniforms" },
    );
  }

  const kids = menuCategories.find((category) => category.slug === KIDS_SLUG);
  if (kids) {
    const kidsLinks = visible(kids.children).map(toNavLink);
    items.push(
      kidsLinks.length > 0
        ? { id: "kids-wear", kind: "simple", label: "Kids Wear", href: "/kids-wear", children: kidsLinks }
        : { id: "kids-wear", kind: "link", label: "Kids Wear", href: "/kids-wear" },
    );
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
