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

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">404</p>
      <h1 className="mt-4 font-display text-3xl font-bold text-ink">Page not found</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        The page you are looking for may have moved or no longer exists. Explore the shop or
        contact us for institutional enquiries.
      </p>
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
