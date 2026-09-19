"use client";

import { useState } from "react";

/**
 * F3 fix (docs/audit-2026-09-19/storefront-ux.md): shared "Resend
 * verification email" control, used on both required surfaces — the
 * review-gating banner (src/components/product/product-detail.tsx) and
 * the account/profile page (src/components/account/account-tabs.tsx) — so
 * the fetch/status logic lives in one place. `email` is always a value the
 * caller already knows server-side (the logged-in customer's own address,
 * from their session) — never a value the customer types here — but the
 * API itself re-derives everything from a fresh DB lookup regardless, so
 * that's a UX convenience, not a trust boundary.
 */
export function ResendVerificationButton({
  email,
  className,
}: {
  email: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");

  const handleClick = async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/account/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) {
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <p className={className ?? "text-sm font-medium text-trust"}>
        If that email needs verifying, a new link is on its way — check your inbox.
      </p>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={status === "loading"}
        className="text-sm font-semibold text-brand hover:underline disabled:opacity-60"
      >
        {status === "loading" ? "Sending…" : "Resend verification email"}
      </button>
      {status === "error" && (
        <p className="mt-1 text-xs text-red-600">Too many attempts. Please wait a moment and try again.</p>
      )}
    </div>
  );
}
