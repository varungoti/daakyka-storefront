"use client";

import { Button, buttonClassNames } from "@/components/ui/button";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-segment error boundary for a single product page — a friendlier
 * message than the root fallback (src/app/error.tsx) since we know
 * exactly what failed to load here.
 */
export default function ProductError({
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
      <h1 className="mt-4 font-display text-3xl font-bold text-ink">
        Something went wrong loading this product
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        We couldn&apos;t load this product page. Please try again, or browse the rest of the shop.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Button onClick={reset}>Try again</Button>
        <Link href="/shop" className={buttonClassNames({ variant: "outline" })}>
          Browse shop
        </Link>
      </div>
    </div>
  );
}
