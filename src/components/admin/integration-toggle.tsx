"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function IntegrationToggle({
  provider,
  enabled,
  configured,
  hasCredentialForm = false,
}: {
  provider: string;
  enabled: boolean;
  configured: boolean;
  /** F-215: Razorpay/Brevo can be configured right here in the admin UI —
   * "Configure env vars first" was actively wrong for Brevo, which has a
   * credential form directly below this toggle. */
  hasCredentialForm?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isEnabled, setIsEnabled] = useState(enabled);
  // F-267: this local state used to only ever read `enabled` on first
  // mount, so it went stale as soon as the server value changed out from
  // under it — e.g. saving a Brevo credential pair auto-enables the
  // provider server-side and calls router.refresh(), but a Server
  // Component re-render doesn't remount this Client Component, so the
  // toggle kept showing "Disabled" until a full page reload. Track the
  // last `enabled` prop seen and resync during render (React's documented
  // "adjusting state when a prop changes" pattern) instead of an effect,
  // which would set state a frame late and trigger an extra render.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    setIsEnabled(enabled);
  }

  const toggle = async () => {
    setLoading(true);
    const next = !isEnabled;
    const response = await fetch(`/api/admin/integrations/${provider.toLowerCase()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (response.ok) {
      setIsEnabled(next);
      router.refresh();
    }
    setLoading(false);
  };

  return (
    <button
      type="button"
      disabled={loading || !configured}
      onClick={toggle}
      // F-243 fix: `text-trust` is ~2.8:1 on `bg-trust/15`, below WCAG
      // AA's 4.5:1 — `text-trust-ink` is the existing F-299 token built
      // for exactly this (~6:1 on the same tint).
      className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        isEnabled ? "bg-trust/15 text-trust-ink" : "bg-lavender/60 text-muted"
      }`}
      title={
        configured
          ? "Toggle provider in admin"
          : hasCredentialForm
            ? "Add credentials below first"
            : "Configure env vars first"
      }
    >
      {loading ? "Saving…" : isEnabled ? "Enabled — click to disable" : "Disabled — click to enable"}
    </button>
  );
}
