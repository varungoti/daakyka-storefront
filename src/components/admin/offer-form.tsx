"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface OfferFormInitial {
  id: string;
  name: string;
  type: string;
  description: string;
  active: boolean;
  config: string;
}

export function OfferForm({ initial }: { initial?: OfferFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState(initial?.type ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [configText, setConfigText] = useState(
    initial?.config ? JSON.stringify(JSON.parse(initial.config), null, 2) : "{}",
  );

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);

    let config: Record<string, unknown>;
    try {
      config = configText.trim() ? JSON.parse(configText) : {};
      if (typeof config !== "object" || Array.isArray(config) || config === null) {
        throw new Error("Config must be a JSON object");
      }
    } catch {
      setStatus("error");
      setErrorMessage('Config must be valid JSON (an object), e.g. { "discount": "10%" }');
      return;
    }

    const payload = { name: name.trim(), type: type.trim(), description: description.trim(), active, config };

    const response = await fetch(isEdit ? `/api/admin/offers/${initial!.id}` : "/api/admin/offers", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus("error");
      setErrorMessage(body?.error ?? "Couldn't save — check the fields above.");
      return;
    }

    router.push("/admin/offers");
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Type" hint="e.g. bundle, free_shipping, first_purchase, bulk, festival">
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <Field label="Config (JSON)" hint='Arbitrary offer parameters, e.g. { "discount": "10%", "minItems": 2 }'>
        <textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          rows={5}
          spellCheck={false}
          className="w-full rounded-xl border border-border p-2.5 font-mono text-xs text-ink outline-none focus:border-brand"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (visible in the homepage offers strip)
      </label>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || !name.trim() || !type.trim() || !description.trim()}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create offer"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/offers")}
          className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}
