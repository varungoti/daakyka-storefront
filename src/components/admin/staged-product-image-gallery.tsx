"use client";

import Image from "next/image";
import { useState } from "react";
import {
  addStagedImage,
  addStagedImages,
  moveStagedImage,
  removeStagedImage,
  updateStagedImage,
  type StagedImage,
} from "@/lib/admin/staged-images";

interface GeneratedCandidate {
  id: string;
  url: string;
  selected: boolean;
}

/**
 * Release-hardening F-04 (docs/audit-2026-09-19/admin-ux.md): the Images
 * panel for a brand-new, not-yet-saved product. Renders in place of the old
 * "Save the product as a draft first to add images" message on
 * `/admin/products/new` — see product-form.tsx, which swaps this out for
 * the real `ProductImageGallery` the instant a `productId` exists (either
 * because this is an edit, or because the create just succeeded and staged
 * images were attached — see attach-staged-images.ts).
 *
 * Deliberately reuses the exact same upload (`POST /api/admin/media`) and
 * AI-generate (`POST /api/admin/media/generate`) endpoints
 * `ProductImageGallery` uses — both already create a `MediaAsset` without
 * requiring a product id, so there was never a real technical reason images
 * had to wait for a saved product; only the *attach* step
 * (`POST /api/admin/products/[id]/images`) genuinely needs one, and that
 * now happens automatically right after create (see product-form.tsx's
 * `saveDraft()`). No second upload/generation path is introduced here.
 *
 * Every image added here is already a real, durably-stored `MediaAsset` —
 * "staging" only means "not yet linked to a product," not "not yet
 * uploaded." That's why "Remove" here calls
 * `DELETE /api/admin/media/[id]` (deleteUnattachedMediaAsset — see
 * src/lib/media/store.ts) to actually delete the asset, unlike the saved
 * gallery's remove, which only detaches it (keeps the MediaAsset for
 * possible reuse). It's also why the product form's unsaved-changes guard
 * treats a non-empty staged list as "dirty" (see product-form.tsx) — an
 * abandoned staged photo isn't nothing, it's real, spent storage, and
 * scripts/cleanup-orphaned-media.ts is the eventual backstop for whatever
 * the admin abandons without confirming through that guard.
 */
export function StagedProductImageGallery({
  images,
  productColors,
  aiFields,
  onChange,
}: {
  images: StagedImage[];
  productColors: string[];
  aiFields: { name?: string; category?: string; gender?: string; fabric?: string };
  onChange: (images: StagedImage[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [promptOverride, setPromptOverride] = useState("");
  const [variationCount, setVariationCount] = useState(1);
  const [candidates, setCandidates] = useState<GeneratedCandidate[]>([]);

  async function onUploadFiles(files: FileList) {
    setUploading(true);
    setNotice(null);
    let current = images;
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append("file", file);
      form.append("usage", "PRODUCT");
      const response = await fetch("/api/admin/media", { method: "POST", body: form });
      if (response.status === 503) {
        setNotice("Image storage isn't configured yet — ask an admin to set up Cloudflare R2.");
        continue;
      }
      if (!response.ok) {
        setNotice("One or more uploads failed.");
        continue;
      }
      const body = await response.json();
      current = addStagedImage(current, { mediaAssetId: body.asset.id, url: body.asset.url, alt: aiFields.name ?? "", color: null });
      onChange(current);
    }
    setUploading(false);
  }

  async function onGenerate() {
    setGenerating(true);
    setNotice(null);
    setCandidates([]);
    const results: GeneratedCandidate[] = [];
    for (let i = 0; i < variationCount; i++) {
      const response = await fetch("/api/admin/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: "product",
          fields: { name: aiFields.name, category: aiFields.category, gender: aiFields.gender, fabric: aiFields.fabric },
          promptOverride: promptOverride.trim() || undefined,
          aspect: "square",
          usage: "PRODUCT",
        }),
      });
      if (response.status === 503) {
        setNotice("AI image generation isn't configured yet — ask an admin to set OPENAI_API_KEY.");
        break;
      }
      if (response.status === 429) {
        setNotice("Daily AI image limit reached — try again tomorrow.");
        break;
      }
      if (!response.ok) {
        setNotice("Generation failed for one or more variations.");
        continue;
      }
      const body = await response.json();
      results.push({ id: body.asset.id, url: body.asset.url, selected: true });
    }
    setCandidates(results);
    setGenerating(false);
  }

  function addSelectedCandidates() {
    const selected = candidates.filter((c) => c.selected);
    // Unlike the saved gallery, nothing needs attaching here — the
    // generate call above already created a real MediaAsset for each
    // candidate, so accepting one just means staging it.
    onChange(addStagedImages(images, selected.map((c) => ({ mediaAssetId: c.id, url: c.url, alt: aiFields.name ?? "", color: null }))));
    setCandidates([]);
  }

  async function remove(mediaAssetId: string) {
    setRemovingId(mediaAssetId);
    setNotice(null);
    const response = await fetch(`/api/admin/media/${mediaAssetId}`, { method: "DELETE" });
    setRemovingId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setNotice(body?.error ?? "Couldn't remove that image — try again.");
      return;
    }
    onChange(removeStagedImage(images, mediaAssetId));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40">
          {uploading ? "Uploading…" : "Upload images"}
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/avif"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) onUploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      <div className="space-y-2 rounded-xl border border-border bg-surface-muted p-3">
        <p className="text-xs font-semibold text-muted">Generate with AI</p>
        <textarea
          value={promptOverride}
          onChange={(e) => setPromptOverride(e.target.value)}
          rows={2}
          placeholder="Optional prompt override — leave blank to auto-fill from name, category, gender and fabric"
          className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-ink"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">
            Variations:
            <select value={variationCount} onChange={(e) => setVariationCount(Number(e.target.value))} className="ml-1 rounded border border-border p-1 text-xs">
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onGenerate} disabled={generating} className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>

        {candidates.length > 0 && (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCandidates((prev) => prev.map((p) => (p.id === c.id ? { ...p, selected: !p.selected } : p)))}
                  className={`relative aspect-square overflow-hidden rounded-lg border-2 ${c.selected ? "border-brand" : "border-border"}`}
                >
                  <Image src={c.url} alt="Generated variation" fill className="object-cover" sizes="120px" />
                </button>
              ))}
            </div>
            <button type="button" onClick={addSelectedCandidates} className="rounded-full border border-brand px-3 py-1.5 text-xs font-semibold text-brand">
              Add selected to gallery
            </button>
          </div>
        )}
      </div>

      {notice ? <p className="text-xs text-red-600">{notice}</p> : null}

      {images.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted">
          No images yet — uploaded or generated photos will be attached to this product automatically when you save.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, index) => (
            <div key={img.mediaAssetId} className="space-y-2 rounded-xl border border-border p-2">
              <div className="relative aspect-square overflow-hidden rounded-lg bg-lavender/40">
                <Image src={img.url} alt={img.alt ?? ""} fill className="object-cover" sizes="200px" />
              </div>
              <select
                value={img.color ?? ""}
                onChange={(e) => onChange(updateStagedImage(images, img.mediaAssetId, { color: e.target.value || null }))}
                className="w-full rounded border border-border p-1 text-xs"
              >
                <option value="">No colour tag</option>
                {productColors.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              <input
                value={img.alt ?? ""}
                onChange={(e) => onChange(updateStagedImage(images, img.mediaAssetId, { alt: e.target.value }))}
                placeholder="Alt text"
                className="w-full rounded border border-border p-1 text-xs"
              />
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onChange(moveStagedImage(images, img.mediaAssetId, "up"))}
                    className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === images.length - 1}
                    onClick={() => onChange(moveStagedImage(images, img.mediaAssetId, "down"))}
                    className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
                <button
                  type="button"
                  disabled={removingId === img.mediaAssetId}
                  onClick={() => remove(img.mediaAssetId)}
                  className="text-red-600 hover:underline disabled:opacity-50"
                >
                  {removingId === img.mediaAssetId ? "Removing…" : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
