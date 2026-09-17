"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface SeoRecordFormInitial {
  id: string;
  path: string;
  title: string;
  metaDescription: string;
  h1: string | null;
  status: string;
}

const STATUS_OPTIONS = ["ok", "needs_meta", "missing_h1", "review"] as const;

export function SeoRecordForm({ initial }: { initial?: SeoRecordFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [path, setPath] = useState(initial?.path ?? "/");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [metaDescription, setMetaDescription] = useState(initial?.metaDescription ?? "");
  const [h1, setH1] = useState(initial?.h1 ?? "");
  const [statusValue, setStatusValue] = useState(initial?.status ?? "ok");

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);

    const payload = {
      path: path.trim(),
      title: title.trim(),
      metaDescription: metaDescription.trim(),
      h1: h1.trim() || null,
      status: statusValue,
    };

    const response = await fetch(isEdit ? `/api/admin/seo/${initial!.id}` : "/api/admin/seo", {
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

    router.push("/admin/seo");
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <Field label="Path" hint="Must start with / — e.g. / or /shop">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          disabled={isEdit}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand disabled:bg-lavender/30"
        />
      </Field>

      <Field label="Title" hint="Rendered as <title> when this path is / or /shop">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <Field label="Meta description">
        <textarea
          value={metaDescription}
          onChange={(e) => setMetaDescription(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="H1 (optional)">
          <input
            value={h1}
            onChange={(e) => setH1(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Status">
          <select
            value={statusValue}
            onChange={(e) => setStatusValue(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || !path.trim() || !title.trim() || !metaDescription.trim()}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create override"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/seo")}
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
