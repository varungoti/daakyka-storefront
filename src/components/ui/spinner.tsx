import { cn } from "@/lib/utils";

/**
 * Shared brand-colored spinner for route `loading.tsx` boundaries (Phase
 * G SEO/accessibility pass) — a plain CSS spin, no client JS/animation
 * library needed since `loading.tsx` renders on the server while the
 * segment below it streams in.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand",
        className,
      )}
    />
  );
}

/** Centered full-section loading state used by most `loading.tsx` files. */
export function PageLoadingState({ className }: { className?: string }) {
  return (
    <div className={cn("flex min-h-[50vh] w-full items-center justify-center py-24", className)}>
      <Spinner className="h-10 w-10" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
