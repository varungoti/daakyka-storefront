import Link from "next/link";

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
