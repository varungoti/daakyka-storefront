import Link from "next/link";

/**
 * F-171: a missing admin page (or a record that was deleted, once its
 * detail page calls `notFound()`) used to render the storefront's own
 * "Page not found" — customer navigation and all, with no way back into
 * the admin. This renders inside the admin shell instead. `notFound()`
 * thrown from any page under (panel) lands here; a URL that matches no
 * route at all gets here through the catch-all in `[...slug]/page.tsx`.
 */
export default function AdminNotFound() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">404</p>
      <h1 className="mt-3 font-display text-3xl font-bold text-ink">Page not found</h1>
      <p className="mt-3 text-muted">
        That admin page doesn&apos;t exist, or the record you were looking for has been deleted.
      </p>
      <Link
        href="/admin/dashboard"
        className="mt-8 inline-block rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand/90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
