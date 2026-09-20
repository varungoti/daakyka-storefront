"use client";

import { useState } from "react";

interface NotifyWhenAvailableProps {
  variantId: string;
}

/**
 * Shopify-parity gap: "Notify me when available" capture for a sold-out
 * variant. Only ever rendered by product-detail.tsx when the currently
 * selected, DB-tracked variant is out of stock — the server independently
 * re-verifies that before accepting a signup (see POST
 * /api/back-in-stock), so this component's job is just a good submission
 * UX, not enforcement.
 */
export function NotifyWhenAvailable({ variantId }: NotifyWhenAvailableProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim() || status === "submitting") return;

    setStatus("submitting");
    setError(null);

    try {
      const response = await fetch("/api/back-in-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, email: email.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setStatus("error");
        setError(data.error ?? "Could not save your request. Please try again.");
        return;
      }

      setStatus("done");
    } catch {
      setStatus("error");
      setError("Could not save your request. Please check your connection and try again.");
    }
  }

  if (status === "done") {
    return (
      <p className="mt-2 rounded-lg bg-trust/10 px-4 py-3 text-sm font-medium text-trust">
        We&apos;ll email you as soon as this is back in stock.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 rounded-lg border border-dashed border-border p-4">
      <p className="text-sm font-semibold text-ink">Out of stock — notify me when available</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-invalid={status === "error"}
          aria-describedby={status === "error" ? "notify-me-error" : undefined}
          className={`min-w-0 flex-1 rounded-md border bg-white px-3 py-2 text-sm text-ink ${
            status === "error" ? "border-red-400" : "border-border"
          }`}
        />
        <button
          type="submit"
          disabled={status === "submitting" || !email.trim()}
          className="shrink-0 rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "submitting" ? "Saving…" : "Notify Me"}
        </button>
      </div>
      {error && (
        <span id="notify-me-error" className="mt-1 block text-xs font-normal text-red-600">
          {error}
        </span>
      )}
    </form>
  );
}
