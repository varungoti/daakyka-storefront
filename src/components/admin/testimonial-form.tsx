"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MediaLibraryBrowser } from "@/components/admin/media-library-browser";
import { formatApiError } from "@/lib/validation/format-api-error";

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
  // F-211: "choose an existing photo from the Media Library" instead of a
  // free-text URL box.
  const [libraryOpen, setLibraryOpen] = useState(false);

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});

    const payload = { quote, name, title, rating, avatar, featured, active, sortOrder };

    try {
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
        const formatted = formatApiError(body, "Couldn't save — check the fields above.");
        setStatus("error");
        setErrorMessage(formatted.summary);
        setFieldErrors(formatted.fieldErrors);
        return;
      }
    } catch {
      // F-219: a network failure used to leave the form stuck on "Saving…".
      setStatus("error");
      setErrorMessage("Couldn't save — check your connection and try again.");
      return;
    }

    router.push("/admin/testimonials");
    router.refresh();
  };

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <Field label="Quote" error={fieldErrors.quote}>
        <textarea
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          rows={4}
          aria-invalid={Boolean(fieldErrors.quote)}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={fieldErrors.name}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Title / role" error={fieldErrors.title}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={Boolean(fieldErrors.title)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Rating (1-5)" error={fieldErrors.rating}>
          <input
            type="number"
            min={1}
            max={5}
            value={rating}
            onChange={(e) => setRating(Number(e.target.value))}
            aria-invalid={Boolean(fieldErrors.rating)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Sort order" error={fieldErrors.sortOrder}>
          <input
            type="number"
            min={0}
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            aria-invalid={Boolean(fieldErrors.sortOrder)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <Field label="Photo" hint="Optional — shows initials when left empty" error={fieldErrors.avatar}>
        <div className="flex items-center gap-3">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-border bg-lavender/40">
            {avatar ? (
              <Image src={avatar} alt="" fill className="object-cover" sizes="64px" />
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] text-muted">
                {name.trim() ? name.trim().charAt(0).toUpperCase() : "—"}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40"
            >
              Choose from library
            </button>
            {avatar && (
              <button
                type="button"
                onClick={() => setAvatar("")}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-red-50 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </Field>

      {libraryOpen && (
        <MediaLibraryBrowser
          title="Choose a testimonial photo"
          defaultUsage="AVATAR"
          onClose={() => setLibraryOpen(false)}
          onSelect={(asset) => {
            setLibraryOpen(false);
            setAvatar(asset.url);
          }}
        />
      )}

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
          disabled={status === "saving" || !quote.trim() || !name.trim() || !title.trim()}
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
