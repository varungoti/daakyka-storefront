"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes";
import { isDirty } from "@/lib/admin/is-dirty";
import { formatApiError } from "@/lib/validation/format-api-error";
import type { HeroContent } from "@/lib/homepage";

export function HomepageEditor({
  heroContent,
}: {
  heroContent: HeroContent;
}) {
  const [content, setContent] = useState(heroContent);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // F-13: unsaved-changes protection for this panel's own edits. A plain
  // useRef(content) would read `.current` during render, which this
  // repo's react-hooks/refs lint rule rejects — see
  // src/components/admin/product-form.tsx's own buildSnapshot() for the
  // fuller explanation.
  const [initialSnapshot, setInitialSnapshot] = useState(content);
  const dirty = isDirty(content, initialSnapshot);
  useUnsavedChangesGuard(dirty);

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});
    const response = await fetch("/api/admin/homepage/hero", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });

    if (!response.ok) {
      // F-02/F-05: this route previously accepted any JSON with zero
      // validation (see src/app/api/admin/homepage/[key]/route.ts and
      // src/lib/validation/schemas.ts's heroContentSchema); now that it
      // can actually reject a bad edit, this panel needs to say why,
      // rather than the generic "Save failed" it showed before.
      const body = await response.json().catch(() => ({}));
      const { summary, fieldErrors: fe } = formatApiError(body, "Save failed.");
      setStatus("error");
      setErrorMessage(summary);
      setFieldErrors(fe);
      return;
    }

    setInitialSnapshot(content);
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  };

  return (
    <div className="space-y-6 rounded-3xl border border-border bg-surface p-6">
      <div>
        <h2 className="font-display text-xl font-bold text-ink">Hero Section</h2>
        <p className="text-sm text-muted">Edit homepage hero copy shown on the storefront.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(
          [
            ["eyebrow", "Eyebrow"],
            ["headline", "Headline"],
            ["subheadline", "Subheadline"],
            ["primaryCta", "Primary CTA"],
            ["secondaryCta", "Secondary CTA"],
            ["rating", "Rating"],
            ["ratingLabel", "Rating Label"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label htmlFor={`hero-${key}`} className="mb-2 block text-sm font-semibold text-ink">
              {label}
            </label>
            <input
              id={`hero-${key}`}
              value={content[key]}
              onChange={(e) => setContent({ ...content, [key]: e.target.value })}
              aria-invalid={Boolean(fieldErrors[key])}
              className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
            />
            {fieldErrors[key] ? <p className="mt-1 text-[11px] font-medium text-red-600">{fieldErrors[key]}</p> : null}
          </div>
        ))}
      </div>

      <div>
        <label htmlFor="hero-description" className="mb-2 block text-sm font-semibold text-ink">
          Description
        </label>
        <textarea
          id="hero-description"
          value={content.description}
          onChange={(e) => setContent({ ...content, description: e.target.value })}
          rows={3}
          className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
        />
        {fieldErrors.description ? <p className="mt-1 text-[11px] font-medium text-red-600">{fieldErrors.description}</p> : null}
      </div>

      <FormErrorBanner message={errorMessage} />

      <div className="flex items-center gap-4">
        <Button onClick={save} disabled={status === "saving"}>
          {status === "saving" ? "Saving..." : "Save Hero"}
        </Button>
        {status === "saved" && <span className="text-sm text-trust">Saved successfully</span>}
      </div>
    </div>
  );
}
