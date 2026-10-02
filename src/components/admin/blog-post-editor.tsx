"use client";

import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { MediaLibraryBrowser } from "@/components/admin/media-library-browser";
import { Button } from "@/components/ui/button";
import { blogSlugify } from "@/lib/blog/content";
import { formatIstDateOnly } from "@/lib/format/datetime";
import { formatApiError } from "@/lib/validation/format-api-error";
import { useRouter } from "next/navigation";
import { useState } from "react";

type TextField = "title" | "slug" | "excerpt" | "category" | "author" | "publishedAt" | "readTime";

const FIELDS: ReadonlyArray<readonly [TextField, string, "text" | "date"]> = [
  ["title", "Title", "text"],
  ["slug", "Slug", "text"],
  ["excerpt", "Excerpt", "text"],
  ["category", "Category", "text"],
  ["author", "Author", "text"],
  // F-331: a plain text field let the owner type any string, including one
  // Date couldn't parse or a format that reads as a different day once parsed
  // (see the API routes' parseIstDateOnly fix). `type="date"` guarantees a
  // "YYYY-MM-DD" value the same way the admin orders date filter already
  // relies on (parseIstDateOnly's own doc comment).
  ["publishedAt", "Published Date", "date"],
  ["readTime", "Read Time", "text"],
];

export function BlogPostEditor({
  initial,
}: {
  initial?: {
    id?: string;
    slug: string;
    title: string;
    excerpt: string;
    category: string;
    author: string;
    publishedAt: string;
    readTime: string;
    image: string;
    content: string[];
    status: "DRAFT" | "PUBLISHED";
  };
}) {
  const router = useRouter();
  const [form, setForm] = useState(
    initial ?? {
      slug: "",
      title: "",
      excerpt: "",
      category: "Guide",
      author: "DAAKYKA Editorial",
      // F-331: `new Date().toISOString().slice(0, 10)` (the old default)
      // reads the UTC calendar date — after IST midnight but before UTC
      // midnight (00:00-05:29 IST) it defaulted to yesterday.
      publishedAt: formatIstDateOnly(),
      readTime: "5 min read",
      image: "",
      content: [""],
      status: "DRAFT" as const,
    },
  );
  const [status, setStatus] = useState<"idle" | "saving" | "deleting" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [libraryOpen, setLibraryOpen] = useState(false);
  // F-216: fill the slug in from the title until the owner edits it by hand
  // (or for an existing post, never — changing a live post's URL silently
  // would break its links). The slug used to be free text: a title typed
  // into it ("Audit Blog 123") saved and even published, but /blog/<slug>
  // 404s for anything that isn't lowercase-and-hyphens.
  const [slugEdited, setSlugEdited] = useState(Boolean(initial?.id));
  const busy = status === "saving" || status === "deleting";

  // A content error can come back keyed per paragraph ("content.0"); show
  // the first one against the single textarea that holds them all.
  const fieldError = (name: string): string | undefined =>
    fieldErrors[name] ?? Object.entries(fieldErrors).find(([key]) => key.startsWith(`${name}.`))?.[1];

  const setField = (key: TextField | "image", value: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "title" && !slugEdited) next.slug = blogSlugify(value);
      return next;
    });
  };

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});
    const payload = {
      ...form,
      content: form.content.map((paragraph) => paragraph.trim()).filter(Boolean),
    };

    let response: Response;
    try {
      response = await fetch(initial?.id ? `/api/admin/blog/${initial.id}` : "/api/admin/blog", {
        method: initial?.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't reach the server — check your connection and try again.");
      return;
    }

    if (!response.ok) {
      // F-216: this used to show only "Save failed. Check all fields." for
      // every failure (a duplicate slug, a bad date, an invalid image, a 403),
      // so the owner couldn't tell which field to fix.
      const body = await response.json().catch(() => ({}));
      const { summary, fieldErrors: fe } = formatApiError(body, "Save failed. Check all fields.");
      setStatus("error");
      setErrorMessage(summary);
      setFieldErrors(fe);
      return;
    }

    router.push("/admin/blog");
    router.refresh();
  };

  // F-216/F-213: the API's DELETE worked but nothing in the UI called it, so
  // a broken or unwanted draft (e.g. a Hermes-approved one) could never be
  // removed from the admin.
  const remove = async () => {
    if (!initial?.id) return;
    if (!window.confirm(`Delete "${form.title || "this article"}"? This can't be undone.`)) return;
    setStatus("deleting");
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/admin/blog/${initial.id}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) {
        const body = await response.json().catch(() => ({}));
        setStatus("error");
        setErrorMessage(formatApiError(body, "Couldn't delete this article.").summary);
        return;
      }
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't reach the server — check your connection and try again.");
      return;
    }
    router.push("/admin/blog");
    router.refresh();
  };

  return (
    <div className="space-y-4 rounded-3xl border border-border bg-surface p-6">
      {FIELDS.map(([key, label, type]) => (
        <div key={key}>
          <label htmlFor={`blog-${key}`} className="mb-2 block text-sm font-semibold text-ink">
            {label}
          </label>
          <input
            id={`blog-${key}`}
            type={type}
            value={form[key]}
            onChange={(e) => {
              if (key === "slug") setSlugEdited(true);
              setField(key, e.target.value);
            }}
            // F-216: tidy a hand-typed slug (spaces, capitals, punctuation)
            // into the lowercase-hyphen form the API requires when the owner
            // leaves the field, rather than rejecting it on save.
            onBlur={key === "slug" ? () => setField("slug", blogSlugify(form.slug)) : undefined}
            aria-invalid={Boolean(fieldError(key))}
            aria-describedby={fieldError(key) ? `blog-${key}-error` : undefined}
            className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
          />
          {key === "slug" ? (
            <p className="mt-1 text-xs text-muted">
              The article&apos;s web address: /blog/{form.slug || "your-slug"}. Lowercase letters, numbers and
              hyphens only.
            </p>
          ) : null}
          {fieldError(key) ? (
            <p id={`blog-${key}-error`} className="mt-1 text-xs font-medium text-red-600">
              {fieldError(key)}
            </p>
          ) : null}
        </div>
      ))}

      <div>
        <label htmlFor="blog-image" className="mb-2 block text-sm font-semibold text-ink">
          Image
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="blog-image"
            type="text"
            value={form.image}
            onChange={(e) => setField("image", e.target.value)}
            placeholder="Choose from the library, or paste /path or https:// URL"
            aria-invalid={Boolean(fieldError("image"))}
            aria-describedby={fieldError("image") ? "blog-image-error" : undefined}
            className="min-w-0 flex-1 rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
          />
          {/* F-216: the field was a bare URL box that rejected every Media
              Library URL (they're root-relative /cdn/... paths) — and there
              was no picker. MediaLibraryBrowser's onSelect never re-uploads
              or duplicates the asset; this just stores its URL. */}
          <button
            type="button"
            onClick={() => setLibraryOpen(true)}
            className="rounded-xl border border-border px-4 py-3 text-sm font-semibold text-muted hover:bg-lilac/40"
          >
            Choose from library
          </button>
        </div>
        {fieldError("image") ? (
          <p id="blog-image-error" className="mt-1 text-xs font-medium text-red-600">
            {fieldError("image")}
          </p>
        ) : null}
      </div>
      {libraryOpen && (
        <MediaLibraryBrowser
          title="Choose article image"
          defaultUsage="BLOG"
          onClose={() => setLibraryOpen(false)}
          onSelect={(asset) => {
            setField("image", asset.url);
            setLibraryOpen(false);
          }}
        />
      )}

      <div>
        <label htmlFor="blog-status" className="mb-2 block text-sm font-semibold text-ink">
          Status
        </label>
        <select
          id="blog-status"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value as "DRAFT" | "PUBLISHED" })}
          className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
        >
          <option value="DRAFT">Draft</option>
          <option value="PUBLISHED">Published</option>
        </select>
      </div>

      <div>
        <label htmlFor="blog-content" className="mb-2 block text-sm font-semibold text-ink">
          Content Paragraphs
        </label>
        <textarea
          id="blog-content"
          value={form.content.join("\n\n")}
          onChange={(e) => setForm({ ...form, content: e.target.value.split("\n\n") })}
          rows={10}
          aria-invalid={Boolean(fieldError("content"))}
          aria-describedby={fieldError("content") ? "blog-content-error" : undefined}
          className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
          placeholder="Separate paragraphs with a blank line"
        />
        {fieldError("content") ? (
          <p id="blog-content-error" className="mt-1 text-xs font-medium text-red-600">
            {fieldError("content")}
          </p>
        ) : null}
      </div>

      <FormErrorBanner message={errorMessage} />

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {status === "saving" ? "Saving..." : "Save Article"}
        </Button>
        {initial?.id ? (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "deleting" ? "Deleting…" : "Delete article"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
