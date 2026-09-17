/**
 * Phase C6: the footer's Shop/Help/Company link columns — a pure,
 * zero-dependency builder function.
 *
 * This is deliberately kept in its own module, separate from
 * get-footer-links.ts's async getFooterLinks() (which reads SiteSetting via
 * @/lib/settings -> @/lib/db -> `pg`). footer.tsx calls buildFooterLinks()
 * directly at render time (it isn't just a type), and Footer is rendered
 * from the client "use client" SiteShell — so if this function lived in
 * the same module as the DB-reading wrapper, importing it would drag the
 * whole `pg` module graph into the client bundle (Next.js build fails with
 * "Module not found: Can't resolve 'net'/'tls'" etc). Keeping this file
 * free of any server-only imports is what makes it safe to import at
 * runtime from a client component tree.
 */

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

export interface FooterLinks {
  shop: FooterColumn;
  help: FooterColumn;
  company: FooterColumn;
}

export interface FooterFlags {
  fabricTechEnabled: boolean;
  mixMatchEnabled: boolean;
  saleEnabled: boolean;
}

export function buildFooterLinks(flags: FooterFlags): FooterLinks {
  const shopLinks: FooterLink[] = [
    { label: "Shop All", href: "/shop" },
    { label: "For Hospitals", href: "/for-hospitals" },
    { label: "School Uniforms", href: "/school-uniforms" },
    { label: "Kids Wear", href: "/kids-wear" },
  ];
  if (flags.saleEnabled) {
    shopLinks.push({ label: "Sale", href: "/sale" });
  }

  const helpLinks: FooterLink[] = [
    { label: "Size Guide", href: "/size-guide" },
    { label: "Shipping", href: "/shipping" },
    { label: "Returns", href: "/returns" },
    { label: "Contact", href: "/contact" },
    { label: "Bulk Orders", href: "/bulk-orders" },
  ];

  const companyLinks: FooterLink[] = [
    { label: "Our Story", href: "/our-story" },
    { label: "About", href: "/about" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ];
  if (flags.fabricTechEnabled) {
    companyLinks.push({ label: "Fabric Technology", href: "/fabric-technology" });
  }
  if (flags.mixMatchEnabled) {
    companyLinks.push({ label: "Mix & Match", href: "/mix-and-match" });
  }

  return {
    shop: { title: "Shop", links: shopLinks },
    help: { title: "Help", links: helpLinks },
    company: { title: "Company", links: companyLinks },
  };
}
