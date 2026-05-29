"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function IntegrationToggle({
  provider,
  enabled,
  configured,
}: {
  provider: string;
  enabled: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isEnabled, setIsEnabled] = useState(enabled);

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
      className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
        isEnabled ? "bg-trust/15 text-trust" : "bg-lavender/60 text-muted"
      }`}
      title={configured ? "Toggle provider in admin" : "Configure env vars first"}
    >
      {loading ? "Saving…" : isEnabled ? "Enabled — click to disable" : "Disabled — click to enable"}
    </button>
  );
}
