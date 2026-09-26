"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SettingKey } from "@/lib/settings";

export function SiteSettingToggle({
  settingKey,
  enabled,
  label,
}: {
  settingKey: SettingKey;
  enabled: boolean;
  label: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggle = async () => {
    setLoading(true);
    setErrorMessage(null);
    const next = !isEnabled;
    const response = await fetch(`/api/admin/settings/${settingKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: next }),
    });
    if (response.ok) {
      setIsEnabled(next);
      router.refresh();
    } else {
      setErrorMessage("Couldn't save — try again.");
    }
    setLoading(false);
  };

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        {errorMessage ? <p className="mt-1 text-xs text-red-600">{errorMessage}</p> : null}
      </div>
      <button
        type="button"
        disabled={loading}
        onClick={toggle}
        // F-243 fix: `text-trust` is ~2.8:1 on `bg-trust/15`, below WCAG
        // AA's 4.5:1 — `text-trust-ink` is the existing F-299 token built
        // for exactly this (~6:1 on the same tint).
        className={`rounded-full px-3 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
          isEnabled ? "bg-trust/15 text-trust-ink" : "bg-lavender/60 text-muted"
        }`}
      >
        {loading ? "Saving…" : isEnabled ? "Enabled — click to disable" : "Disabled — click to enable"}
      </button>
    </div>
  );
}
