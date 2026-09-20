"use client";

import { Button, buttonClassNames } from "@/components/ui/button";
import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-segment error boundary for /checkout (release-hardening item 3,
 * docs/audit-2026-09-19/correctness.md F18) — previously fell back to the
 * root boundary (src/app/error.tsx), which sends a shopper mid-purchase
 * all the way back to the homepage. Checkout is the single highest-value
 * page to keep partially recoverable: the cart itself lives in
 * localStorage (src/context/cart-store.ts), entirely independent of this
 * page's render tree, so a rendering error here never loses it — this
 * boundary says so explicitly and offers a retry in place, instead of
 * implying the cart/order might be gone.
 */
export default function CheckoutError({
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
      <h1 className="mt-4 font-display text-3xl font-bold text-ink">Checkout hit a snag</h1>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Your cart is safe — nothing was lost. Please try again, or go back to your cart to confirm
        it before continuing.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Button onClick={reset}>Try again</Button>
        <Link href="/shop" className={buttonClassNames({ variant: "outline" })}>
          Continue shopping
        </Link>
      </div>
      <p className="mt-6 text-xs text-muted">
        Still stuck?{" "}
        <Link href="/contact?intent=checkout" className="text-brand underline underline-offset-2">
          Contact us
        </Link>{" "}
        with your cart details.
      </p>
    </div>
  );
}
