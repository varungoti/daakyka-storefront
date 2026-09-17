"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface PickedAsset {
  id: string;
  url: string;
  alt: string | null;
}

interface MediaAssetRow {
  id: string;
  url: string;
  alt: string | null;
}

type Mode = "closed" | "recent" | "generate";

/**
 * Simple image picker used by the category form (Phase B2): pick a
 * recent asset for the given `usage`, upload a new one, or generate one
 * with AI. Intentionally minimal — the full media library (grid, filters,
 * "which products use this") is a separate, later admin screen.
 */
export function MediaPicker({
  usage,
  value,
  onChange,
  aiFields,
}: {
  usage: "CATEGORY";
  value: PickedAsset | null;
  onChange: (asset: PickedAsset | null) => void;
  /** Pre-fills the AI generation prompt fields (e.g. category name/section). */
  aiFields?: { name?: string; category?: string };
}) {
  const [mode, setMode] = useState<Mode>("closed");
  const [recent, setRecent] = useState<MediaAssetRow[] | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [promptOverride, setPromptOverride] = useState("");

  const openRecent = () => {
    if (mode === "recent") {
      setMode("closed");
      return;
    }
    setMode("recent");
    if (recent !== null) return;
    setLoadingRecent(true);
    fetch(`/api/admin/media?usage=${usage}&limit=24`)
      .then(async (res) => {
        if (!res.ok) throw new Error("failed");
        const body = await res.json();
        setRecent(body.assets ?? []);
      })
      .catch(() => setNotice("Couldn't load recent images — try again."))
      .finally(() => setLoadingRecent(false));
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    setNotice(null);
    const form = new FormData();
    form.append("file", file);
    form.append("usage", usage);
    const response = await fetch("/api/admin/media", { method: "POST", body: form });
    setUploading(false);
    if (response.status === 503) {
      setNotice("Image storage isn't configured yet — ask an admin to set up Cloudflare R2.");
      return;
    }
    if (!response.ok) {
      setNotice("Upload failed — try a different image.");
      return;
    }
    const body = await response.json();
    onChange({ id: body.asset.id, url: body.asset.url, alt: body.asset.alt ?? null });
    setMode("closed");
  };

  const onGenerate = async () => {
    setGenerating(true);
    setNotice(null);
    const response = await fetch("/api/admin/media/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preset: "category-tile",
        fields: { name: aiFields?.name, category: aiFields?.category },
        promptOverride: promptOverride.trim() || undefined,
        aspect: "landscape",
        usage,
      }),
    });
    setGenerating(false);
    if (response.status === 503) {
      setNotice("AI image generation isn't configured yet — ask an admin to set OPENAI_API_KEY.");
      return;
    }
    if (response.status === 429) {
      setNotice("Daily AI image limit reached — try again tomorrow, or upload an image instead.");
      return;
    }
    if (!response.ok) {
      setNotice("Generation failed — try again or upload an image instead.");
      return;
    }
    const body = await response.json();
    onChange({ id: body.asset.id, url: body.asset.url, alt: body.asset.alt ?? null });
    setMode("closed");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-border bg-lavender/40">
          {value ? (
            <Image src={value.url} alt={value.alt ?? ""} fill className="object-cover" sizes="112px" />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-muted">No image</div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openRecent}
            className={cn(
              "rounded-full border border-border px-3 py-1.5 text-xs font-semibold",
              mode === "recent" ? "bg-brand/10 text-brand" : "text-muted hover:bg-lilac/40",
            )}
          >
            Choose existing
          </button>
          <label className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40">
            {uploading ? "Uploading…" : "Upload new"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setMode(mode === "generate" ? "closed" : "generate")}
            className={cn(
              "rounded-full border border-border px-3 py-1.5 text-xs font-semibold",
              mode === "generate" ? "bg-brand/10 text-brand" : "text-muted hover:bg-lilac/40",
            )}
          >
            Generate with AI
          </button>
          {value ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-red-50 hover:text-red-600"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {notice ? <p className="text-xs text-red-600">{notice}</p> : null}

      {mode === "recent" && (
        <div className="rounded-xl border border-border bg-surface-muted p-3">
          {loadingRecent && <p className="text-xs text-muted">Loading…</p>}
          {!loadingRecent && recent?.length === 0 && (
            <p className="text-xs text-muted">No existing category images yet — upload or generate one.</p>
          )}
          {!loadingRecent && recent && recent.length > 0 && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {recent.map((asset) => (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() => {
                    onChange({ id: asset.id, url: asset.url, alt: asset.alt });
                    setMode("closed");
                  }}
                  className="relative aspect-square overflow-hidden rounded-lg border border-border hover:ring-2 hover:ring-brand"
                >
                  <Image src={asset.url} alt={asset.alt ?? ""} fill className="object-cover" sizes="80px" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "generate" && (
        <div className="space-y-2 rounded-xl border border-border bg-surface-muted p-3">
          <label className="block text-xs font-semibold text-muted">
            Prompt (optional override — leave blank to auto-fill from the category name)
            <textarea
              value={promptOverride}
              onChange={(event) => setPromptOverride(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-border bg-surface p-2 text-sm text-ink"
            />
          </label>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="rounded-full bg-brand px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
      )}
    </div>
  );
}
