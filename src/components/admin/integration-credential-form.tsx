"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface CredentialFieldState {
  key: string;
  label: string;
  secret: boolean;
  configured: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
  /** Only populated for non-secret fields (e.g. BREVO/FROM_EMAIL) — secret
   * fields never have their value sent to the browser. */
  currentValue?: string;
}

export function IntegrationCredentialForm({
  provider,
  fields,
}: {
  provider: "RAZORPAY" | "BREVO";
  fields: CredentialFieldState[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [field.key, field.secret ? "" : field.currentValue ?? ""])),
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const endpoint = `/api/admin/integrations/${provider.toLowerCase()}/credentials`;

  const save = async (key: string) => {
    const value = drafts[key]?.trim();
    if (!value) return;
    setBusyKey(key);
    setErrorMessage(null);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    setBusyKey(null);
    if (response.ok) {
      router.refresh();
    } else {
      setErrorMessage("Couldn't save that credential.");
    }
  };

  const clear = async (key: string) => {
    setBusyKey(key);
    setErrorMessage(null);
    const response = await fetch(endpoint, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    setBusyKey(null);
    if (response.ok) {
      setDrafts((state) => ({ ...state, [key]: "" }));
      router.refresh();
    } else {
      setErrorMessage("Couldn't clear that credential.");
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-surface p-4">
      {fields.map((field) => (
        <div key={field.key} className="space-y-1.5">
          <label className="block text-xs font-semibold text-muted" htmlFor={`${provider}-${field.key}`}>
            {field.label}
          </label>
          {field.secret && field.configured ? (
            <p className="text-xs text-muted">
              •••• configured
              {field.updatedByName ? ` — last updated by ${field.updatedByName}` : ""}
              {field.updatedAt ? ` on ${new Date(field.updatedAt).toLocaleDateString()}` : ""}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input
              id={`${provider}-${field.key}`}
              type={field.secret ? "password" : "text"}
              autoComplete="off"
              value={drafts[field.key] ?? ""}
              onChange={(event) => {
                setDrafts((state) => ({ ...state, [field.key]: event.target.value }));
                setErrorMessage(null);
              }}
              placeholder={field.secret && field.configured ? "Enter a new value to replace it" : "Not set"}
              className="min-w-0 flex-1 rounded-xl border border-border bg-surface-muted p-2.5 text-sm text-ink"
            />
            <button
              type="button"
              disabled={busyKey === field.key || !drafts[field.key]?.trim()}
              onClick={() => save(field.key)}
              className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyKey === field.key ? "Saving…" : "Save"}
            </button>
            {field.configured ? (
              <button
                type="button"
                disabled={busyKey === field.key}
                onClick={() => clear(field.key)}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:border-red-300 hover:text-red-600 disabled:opacity-50"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
      ))}
      {errorMessage ? <p className="text-xs text-red-600">{errorMessage}</p> : null}
    </div>
  );
}
