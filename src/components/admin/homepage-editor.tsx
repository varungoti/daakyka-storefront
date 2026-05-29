"use client";

import { Button } from "@/components/ui/button";
import type { HeroContent } from "@/lib/homepage";
import { useState } from "react";

export function HomepageEditor({
  heroContent,
}: {
  heroContent: HeroContent;
}) {
  const [content, setContent] = useState(heroContent);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    setStatus("saving");
    const response = await fetch("/api/admin/homepage/hero", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });

    setStatus(response.ok ? "saved" : "error");
    if (response.ok) {
      setTimeout(() => setStatus("idle"), 2000);
    }
  };

  return (
    <div className="space-y-6 rounded-3xl border border-border bg-white p-6">
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
              className="w-full rounded-xl border border-border px-4 py-3 text-sm outline-none focus:border-brand"
            />
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
      </div>

      <div className="flex items-center gap-4">
        <Button onClick={save} disabled={status === "saving"}>
          {status === "saving" ? "Saving..." : "Save Hero"}
        </Button>
        {status === "saved" && <span className="text-sm text-trust">Saved successfully</span>}
        {status === "error" && <span className="text-sm text-red-600">Save failed</span>}
      </div>
    </div>
  );
}
