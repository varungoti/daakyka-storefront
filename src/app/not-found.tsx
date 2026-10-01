import type { Metadata } from "next";
import Link from "next/link";

// F-012: without this, the root 404 kept the layout's default <title>
// ("DAAKYKA Apparels | Quality Uniforms & Linens for Pan India") — a
// visitor on an unknown URL saw a homepage-branded browser tab with no clue
// the page didn't exist. Next already injects its own `noindex` meta tag
// whenever `notFound()` fires (see node_modules/next/dist/docs/01-app/
// 03-api-reference/04-functions/not-found.md), so `follow: true` here keeps
// that from also fighting the root layout's `index, follow` (production
// robots meta used to carry both at once).
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: true },
};

// F-012: a dead end with only "Browse shop"/"Contact us" sent a shopper who
// followed a stale link back to square one — a search box and the three
// section landings (the same destinations as the header's top-level nav)
// give them a way to find what they were after.
const SECTION_LINKS = [
  { label: "For Hospitals", href: "/for-hospitals" },
  { label: "School Uniforms", href: "/school-uniforms" },
  { label: "Kids Wear", href: "/kids-wear" },
];

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">404</p>
      <h1 className="mt-4 font-display text-3xl font-bold text-ink">Page not found</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        The page you are looking for may have moved or no longer exists. Search the shop or
        contact us for institutional enquiries.
      </p>
      <form action="/shop" method="get" role="search" className="mt-8 flex w-full max-w-sm gap-2">
        <label htmlFor="not-found-search" className="sr-only">
          Search the shop
        </label>
        <input
          id="not-found-search"
          type="search"
          name="q"
          placeholder="Search products"
          className="min-w-0 flex-1 rounded-full border border-border px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-violet"
        >
          Search
        </button>
      </form>
      <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-medium">
        {SECTION_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="text-ink transition hover:text-brand">
            {link.label}
          </Link>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          href="/shop"
          className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-violet"
        >
          Browse shop
        </Link>
        <Link
          href="/contact"
          className="rounded-full border border-border px-6 py-3 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
        >
          Contact us
        </Link>
      </div>
    </div>
  );
}
