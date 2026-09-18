"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-segment error boundary for the admin panel. Nested inside
 * `/admin/(panel)/layout.tsx`, so the AdminShell sidebar/nav still renders
 * around this — only the page content area is replaced — unless the
 * error originated in the layout itself, in which case Next falls back
 * to the root `src/app/error.tsx`.
 */
export default function AdminPanelError({
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
    <div className="mx-auto flex min-h-[40vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Something went wrong</p>
      <h1 className="mt-4 font-display text-2xl font-bold text-ink">
        Something went wrong loading this page
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        An unexpected error occurred in the admin panel. Try again, or head back to the dashboard.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Button onClick={reset}>Try again</Button>
        <Link href="/admin/dashboard" className="rounded-md border border-border px-6 py-3 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand">
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
