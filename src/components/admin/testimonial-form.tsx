"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface TestimonialFormInitial {
  id: string;
  quote: string;
  name: string;
  title: string;
  rating: number;
  avatar: string;
  featured: boolean;
  active: boolean;
  sortOrder: number;
}

export function TestimonialForm({ initial }: { initial?: TestimonialFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [quote, setQuote] = useState(initial?.quote ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [rating, setRating] = useState(initial?.rating ?? 5);
  const [avatar, setAvatar] = useState(initial?.avatar ?? "");
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0);

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);

    const payload = { quote, name, title, rating, avatar, featured, active, sortOrder };

    const response = await fetch(
      isEdit ? `/api/admin/testimonials/${initial!.id}` : "/api/admin/testimonials",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus("error");
      setErrorMessage(body?.error ?? "Couldn't save — check the fields above.");
      return;
    }

    router.push("/admin/testimonials");
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <Field label="Quote">
        <textarea
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Title / role">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rating (1-5)">
          <input
            type="number"
            min={1}
            max={5}
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Sort order">
          <input
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <Field label="Avatar URL" hint="Paste an image URL (upload via Media Manager, then copy its URL here)">
        <input
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          placeholder="https://..."
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
          Featured
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      </div>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || !quote.trim() || !name.trim() || !avatar.trim()}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create testimonial"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/testimonials")}
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
