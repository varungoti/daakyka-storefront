import { cn } from "@/lib/utils";

/**
 * Base pulsing placeholder block — the building unit for every route's
 * content-shaped `loading.tsx` skeleton (release-hardening F11/F14: the
 * shared `PageLoadingState` fallback only reserved `min-h-[50vh]` against
 * real pages ~17,600px tall, so the footer jumped thousands of pixels the
 * instant content streamed in — mobile CLS ≈0.54 on `/shop` and the PDP.
 * These skeletons reuse the *same* layout classNames (padding, max-width,
 * grid columns) as the real components they stand in for, so the reserved
 * space actually matches the incoming content instead of guessing a fixed
 * height — see node_modules/next/dist/docs/01-app/02-guides/streaming.md
 * ("Design skeleton fallbacks that match the dimensions of the content
 * they represent").
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}
