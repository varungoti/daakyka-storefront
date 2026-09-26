"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The one error-banner treatment every admin form should use for a failed
 * save (release-hardening F-02 — docs/audit-2026-09-19/admin-ux.md: a
 * server-rejected input previously failed completely silently on several
 * admin forms). Pair with src/lib/validation/format-api-error.ts, which
 * turns the API's `{ error, issues }` response into the human-readable
 * `message` this renders.
 *
 * `role="alert"` + `aria-live="assertive"` means assistive tech announces
 * it the moment it appears, and by default the scroll-into-view guards
 * against it landing below the fold.
 *
 * F-176: that scroll-into-view guard did the opposite for
 * product-form.tsx, the one caller that also renders a `sticky bottom-*`
 * action bar right after this — `block: "nearest"` lines the banner's
 * *bottom* edge up with the viewport's bottom edge, which is exactly
 * where a bottom-sticky bar also sits, so the bar covered all but a
 * ~16px sliver of the message on every failed save. Pass `scroll={false}`
 * when the caller instead renders this somewhere that's already always
 * on screen (e.g. inside that same sticky bar) — see product-form.tsx.
 */
export function FormErrorBanner({
  message,
  scroll = true,
  className,
}: {
  message: string | null;
  scroll?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (message && scroll) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [message, scroll]);

  if (!message) return null;

  return (
    <p
      ref={ref}
      role="alert"
      aria-live="assertive"
      className={cn("rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700", className)}
    >
      {message}
    </p>
  );
}
