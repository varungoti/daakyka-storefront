import Link from "next/link";

/**
 * Previous / "Page X of Y" / Next links for a server-rendered admin list
 * (see src/lib/admin/pagination.ts). A plain server component — the links
 * are ordinary `?page=N` navigations, so there is no client state to keep
 * in sync with the URL and the browser's Back button just works.
 */
export function AdminPager({
  page,
  totalPages,
  total,
  noun,
  hrefForPage,
  label,
}: {
  page: number;
  totalPages: number;
  total: number;
  /** Plural noun for the "N total" tail, e.g. "notifications". */
  noun: string;
  hrefForPage: (page: number) => string;
  /** Accessible name of the `<nav>` landmark. */
  label: string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="flex items-center justify-between gap-3 pt-2 text-sm" aria-label={label}>
      {page > 1 ? (
        <Link href={hrefForPage(page - 1)} className="py-2 font-semibold text-brand hover:underline">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-center text-muted">
        Page {page} of {totalPages} · {total} {noun}
      </span>
      {page < totalPages ? (
        <Link href={hrefForPage(page + 1)} className="py-2 font-semibold text-brand hover:underline">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
