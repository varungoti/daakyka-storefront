"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SegmentFormInitial {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  criteria: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function SegmentForm({ initial }: { initial?: SegmentFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [criteriaText, setCriteriaText] = useState(
    initial?.criteria ? JSON.stringify(JSON.parse(initial.criteria), null, 2) : "{}",
  );

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);

    let criteria: Record<string, unknown>;
    try {
      criteria = criteriaText.trim() ? JSON.parse(criteriaText) : {};
      if (typeof criteria !== "object" || Array.isArray(criteria) || criteria === null) {
        throw new Error("Criteria must be a JSON object");
      }
    } catch {
      setStatus("error");
      setErrorMessage("Criteria must be valid JSON (an object), e.g. { \"source\": \"newsletter\" }");
      return;
    }

    const payload = {
      name: name.trim(),
      slug: slug.trim() || slugify(name),
      description: description.trim() || null,
      criteria,
    };

    const response = await fetch(isEdit ? `/api/admin/segments/${initial!.id}` : "/api/admin/segments", {
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

    router.push("/admin/segments");
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Slug" hint="Lowercase letters, numbers, and hyphens">
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <Field label="Description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <Field
        label="Criteria (JSON)"
        hint='Read by src/lib/engagement/segment-resolver.ts — supported keys: source, consent, leadType, pages. Example: { "source": "newsletter" }'
      >
        <textarea
          value={criteriaText}
          onChange={(e) => setCriteriaText(e.target.value)}
          rows={6}
          spellCheck={false}
          className="w-full rounded-xl border border-border p-2.5 font-mono text-xs text-ink outline-none focus:border-brand"
        />
      </Field>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || !name.trim()}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create segment"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/segments")}
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
