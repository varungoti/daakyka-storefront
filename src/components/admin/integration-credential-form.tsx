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
  // F-267 (checkout-csp-and-brevo-config): the save API now auto-enables
  // Brevo the first time both fields are configured and reports that back
  // as `autoEnabled` — surfaced here so the admin sees it happen instead of
  // separately noticing the toggle above flipped.
  const [autoEnabledMessage, setAutoEnabledMessage] = useState<string | null>(null);
  // F-215: lets an admin prove a saved key pair actually works with the
  // provider before relying on it — a mistyped Razorpay secret or a
  // test/live mismatch used to only surface once a real shopper's checkout
  // failed.
  const [testState, setTestState] = useState<{ status: "idle" | "testing" | "ok" | "error"; message?: string }>({
    status: "idle",
  });

  const endpoint = `/api/admin/integrations/${provider.toLowerCase()}/credentials`;
  const testEndpoint = `/api/admin/integrations/${provider.toLowerCase()}/test`;
  const anyFieldConfigured = fields.some((field) => field.configured);

  const testConnection = async () => {
    setTestState({ status: "testing" });
    const response = await fetch(testEndpoint, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.ok) {
      setTestState({ status: "ok", message: body.message ?? "Connection verified." });
    } else {
      setTestState({ status: "error", message: body.message ?? body.error ?? "Couldn't verify the connection." });
    }
  };

  const save = async (key: string) => {
    const value = drafts[key]?.trim();
    if (!value) return;
    setBusyKey(key);
    setErrorMessage(null);
    setAutoEnabledMessage(null);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const body = await response.json().catch(() => ({}));
    setBusyKey(null);
    if (response.ok) {
      if (body?.autoEnabled) {
        setAutoEnabledMessage(`${provider === "BREVO" ? "Brevo" : provider} was turned on automatically.`);
      }
      router.refresh();
    } else {
      setErrorMessage(body?.error ?? "Couldn't save that credential.");
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
      {autoEnabledMessage ? <p className="text-xs text-trust">{autoEnabledMessage}</p> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          disabled={!anyFieldConfigured || testState.status === "testing"}
          onClick={testConnection}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-lilac/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testState.status === "testing" ? "Testing…" : "Test connection"}
        </button>
        {testState.status === "ok" ? (
          <p className="text-xs text-trust">{testState.message}</p>
        ) : testState.status === "error" ? (
          <p className="text-xs text-red-600">{testState.message}</p>
        ) : null}
      </div>
    </div>
  );
}
