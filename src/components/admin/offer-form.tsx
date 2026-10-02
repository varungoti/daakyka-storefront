"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { formatApiError } from "@/lib/validation/format-api-error";

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});

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

    try {
      const response = await fetch(isEdit ? `/api/admin/offers/${initial!.id}` : "/api/admin/offers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        // F-219: body.error is always the generic "Validation failed" —
        // the real reason (and which field) lives in `issues`.
        const body = await response.json().catch(() => ({}));
        const { summary, fieldErrors: fe } = formatApiError(body, "Couldn't save — check the fields above.");
        setStatus("error");
        setErrorMessage(summary);
        setFieldErrors(fe);
        return;
      }
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't save — check your connection and try again.");
      return;
    }

    router.push("/admin/offers");
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={fieldErrors.name}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Type" hint="e.g. bundle, free_shipping, first_purchase, bulk, festival" error={fieldErrors.type}>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-invalid={Boolean(fieldErrors.type)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <Field label="Description" error={fieldErrors.description}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          aria-invalid={Boolean(fieldErrors.description)}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <Field
        label="Config (JSON)"
        hint='Arbitrary offer parameters, e.g. { "discount": "10%", "minItems": 2 }'
        error={fieldErrors.config}
      >
        <textarea
          value={configText}
          onChange={(e) => setConfigText(e.target.value)}
          rows={5}
          spellCheck={false}
          aria-invalid={Boolean(fieldErrors.config)}
          className="w-full rounded-xl border border-border p-2.5 font-mono text-xs text-ink outline-none focus:border-brand"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active (visible in the homepage offers strip)
      </label>

      <FormErrorBanner message={errorMessage} />

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

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
