"use client";

import { useEffect, useRef } from "react";

/**
 * The one error-banner treatment every admin form should use for a failed
 * save (release-hardening F-02 — docs/audit-2026-09-19/admin-ux.md: a
 * server-rejected input previously failed completely silently on several
 * admin forms). Pair with src/lib/validation/format-api-error.ts, which
 * turns the API's `{ error, issues }` response into the human-readable
 * `message` this renders.
 *
 * `role="alert"` + `aria-live="assertive"` means assistive tech announces
 * it the moment it appears, and the scroll-into-view guards against it
 * landing below the fold or behind a sticky action bar — which is exactly
 * how the original failure could go unnoticed even though *some* error
 * text was technically on the page.
 */
export function FormErrorBanner({ message }: { message: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [message]);

  if (!message) return null;

  return (
    <p
      ref={ref}
      role="alert"
      aria-live="assertive"
      className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700"
    >
      {message}
    </p>
  );
}
