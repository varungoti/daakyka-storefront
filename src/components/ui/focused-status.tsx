"use client";

import { cn } from "@/lib/utils";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * F-241: a form's success confirmation. The newsletter, contact and bulk-
 * order forms replace their whole `<form>` with a confirmation box on
 * success, which unmounts the submit button that had keyboard focus — focus
 * fell back to <body> and nothing was announced. This box is a `role="status"`
 * live region that takes focus when it mounts (`tabIndex={-1}`: focusable by
 * script, not a Tab stop), so a screen reader reads the confirmation and a
 * keyboard user continues from it instead of from the top of the page.
 */
export function FocusedStatus({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div ref={ref} role="status" tabIndex={-1} className={cn("outline-none", className)}>
      {children}
    </div>
  );
}
