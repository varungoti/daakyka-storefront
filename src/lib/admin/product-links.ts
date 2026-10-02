/**
 * F-162: the products list is open to anyone with `products:view`
 * (SEO_MANAGER is the one role that has it without `products:manage`), but
 * the product editor (/admin/products/[id]) requires `products:manage` and
 * silently redirects everyone else to the dashboard. The list used to
 * render a link to that editor on every row regardless — so for a
 * view-only role every product name and every "Edit" link was a dead end
 * that bounced to the dashboard with no explanation.
 *
 * `productRowLinks` is the one place that decides what a row links to for a
 * given viewer, so the desktop table and the phone card list can't drift:
 *  - managers get the editor on the name and an "Edit" action;
 *  - view-only roles get no editor link at all — the name is plain text —
 *    and, for a product that's actually live, a "View" action that opens
 *    its storefront page in a new tab (a draft/archived product has no
 *    public page, so it gets no link rather than a 404).
 */

export interface ProductRowLinkInput {
  id: string;
  slug: string;
  status: string;
}

export interface ProductRowLinks {
  /** Link target for the product name, or null to render it as plain text. */
  nameHref: string | null;
  /** The row's trailing action, or null when the viewer has none. */
  action: { label: "Edit" | "View"; href: string; external: boolean } | null;
}

export function productRowLinks(item: ProductRowLinkInput, canManage: boolean): ProductRowLinks {
  if (canManage) {
    const href = `/admin/products/${item.id}`;
    return { nameHref: href, action: { label: "Edit", href, external: false } };
  }
  if (item.status === "ACTIVE") {
    return { nameHref: null, action: { label: "View", href: `/products/${item.slug}`, external: true } };
  }
  return { nameHref: null, action: null };
}
