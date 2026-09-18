"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ManifestAspect } from "@/data/media/image-manifest";
import { aspectClassName, placeholderForAspect, toGenerationAspect } from "@/data/media/image-manifest";
import type { PromptFields, PromptPreset } from "@/lib/ai/prompt-presets";

export interface SiteImageSlotRow {
  slot: string;
  label: string;
  group: string;
  usage: string;
  preset: PromptPreset;
  aspect: ManifestAspect;
  fields?: PromptFields;
  current: { url: string; alt: string } | null;
}

/**
 * Phase E2: the admin "Site Images" tab — one card per manifest slot
 * (src/data/media/image-manifest.ts, plus the dynamic `category.{slug}`
 * and `blog.post.{slug}` slots), each showing its current image (or the
 * neutral placeholder) with "Generate with AI" and "Replace" actions.
 *
 * Reuses the same two admin API routes the category form's MediaPicker
 * already calls (POST /api/admin/media/generate, POST /api/admin/media),
 * just keyed by `slot` instead of being tied to one category — both
 * routes already accept an optional `slot` and both already return a 503
 * with a friendly message when OPENAI_API_KEY / R2 aren't configured,
 * which is the only state this environment can actually exercise.
 */
export function SiteImagesGrid({ rows: initialRows }: { rows: SiteImageSlotRow[] }) {
  const [rows, setRows] = useState(initialRows);
  const groups = groupBy(rows, (row) => row.group);

  return (
    <div className="space-y-10">
      {[...groups.entries()].map(([group, groupRows]) => (
        <section key={group}>
          <h2 className="mb-4 font-display text-lg font-bold text-ink">{group}</h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {groupRows.map((row) => (
              <SiteImageCard
                key={row.slot}
                row={row}
                onChange={(current) =>
                  setRows((prev) => prev.map((r) => (r.slot === row.slot ? { ...r, current } : r)))
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function SiteImageCard({
  row,
  onChange,
}: {
  row: SiteImageSlotRow;
  onChange: (current: { url: string; alt: string } | null) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const onGenerate = async () => {
    setGenerating(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: row.preset,
          fields: row.fields,
          aspect: toGenerationAspect(row.aspect),
          usage: row.usage,
          slot: row.slot,
          alt: row.label,
        }),
      });
      if (response.status === 503) {
        setNotice("AI image generation isn't configured yet — add OPENAI_API_KEY to enable this.");
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
      onChange({ url: body.asset.url, alt: body.asset.alt ?? "" });
    } catch {
      setNotice("Generation failed — check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("usage", row.usage);
      form.append("slot", row.slot);
      form.append("alt", row.label);
      const response = await fetch("/api/admin/media", { method: "POST", body: form });
      if (response.status === 503) {
        setNotice("Image storage isn't configured yet — ask an admin to set up Cloudflare R2.");
        return;
      }
      if (!response.ok) {
        setNotice("Upload failed — try a different image.");
        return;
      }
      const body = await response.json();
      onChange({ url: body.asset.url, alt: body.asset.alt ?? "" });
    } catch {
      setNotice("Upload failed — check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };

  const previewSrc = row.current?.url ?? placeholderForAspect(row.aspect);

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
      <div className={cn("relative w-full bg-lavender/40", aspectClassName(row.aspect))}>
        <Image
          src={previewSrc}
          alt={row.current?.alt || row.label}
          fill
          className="object-cover"
          sizes="280px"
        />
        {!row.current ? (
          <span className="absolute left-2 top-2 rounded-full bg-ink/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Not generated yet
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="text-sm font-semibold text-ink">{row.label}</p>
        <p className="truncate font-mono text-[11px] text-muted" title={row.slot}>
          {row.slot}
        </p>
        {notice ? <p className="text-xs text-red-600">{notice}</p> : null}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate with AI"}
          </button>
          <label className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40">
            {uploading ? "Uploading…" : row.current ? "Replace" : "Upload"}
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
        </div>
      </div>
    </div>
  );
}
