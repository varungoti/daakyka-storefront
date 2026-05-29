"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-20 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Something went wrong</p>
      <h1 className="mt-4 font-display text-3xl font-bold text-ink">We hit a snag</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        An unexpected error occurred. Please try again, or return to the homepage to keep shopping.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:bg-brand-violet"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-border px-6 py-3 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
