"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * Release-hardening item 2 — fallback for a courier
 * getCourierTrackingUrl (src/lib/orders/courier-tracking.ts) can't
 * confidently turn into a link: a plain, copyable tracking number
 * instead of a guessed/broken URL.
 */
export function CopyTrackingNumber({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (insecure context, older
      // browser, denied permission) — the number is still visible and
      // selectable, so this is a silent no-op rather than a thrown error.
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 font-mono text-sm text-ink transition hover:border-brand"
    >
      <span>{value}</span>
      {copied ? <Check size={14} className="text-trust" aria-hidden /> : <Copy size={14} className="text-muted" aria-hidden />}
      <span className="sr-only">{copied ? "Copied" : "Copy tracking number"}</span>
    </button>
  );
}
