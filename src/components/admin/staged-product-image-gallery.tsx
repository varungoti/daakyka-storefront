"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import {
  addStagedImage,
  addStagedImages,
  moveStagedImage,
  removeStagedImage,
  stageLibraryAssets,
  updateStagedImage,
  type StagedImage,
} from "@/lib/admin/staged-images";
import { moveArrayItem } from "@/lib/admin/reorder";
import { summarizeFailuresByMessage, uploadErrorMessage, uploadFilesSequentially } from "@/lib/admin/retryable-upload";
import { prepareImageForUpload } from "@/lib/media/prepare-upload";
import { MediaLibraryBrowser } from "@/components/admin/media-library-browser";
import { cn } from "@/lib/utils";

/** The product-image API's cap on alt text (F-366) — a longer value would
 * make attaching this staged image to the new product fail. */
const MAX_ALT_LENGTH = 300;

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
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<GeneratedCandidate[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // F-358: same stale-closure guard as ProductImageGallery — an upload
  // batch awaits for as long as the network takes, during which the admin
  // can remove or re-tag another photo; writing back the `images` prop
  // captured when the batch started would silently undo that. Every write
  // goes through `commit`, which also updates this ref synchronously so
  // two writes in the same tick build on each other.
  const latestImages = useRef(images);
  useEffect(() => {
    latestImages.current = images;
  }, [images]);

  function commit(next: StagedImage[]) {
    latestImages.current = next;
    onChange(next);
  }

  /**
   * F-324: see ProductImageGallery's identical fix — a 429 from
   * admin-media-upload's limiter used to be dropped exactly like a bad
   * file, with one generic "One or more uploads failed." and no
   * indication which file(s) didn't make it. uploadFilesSequentially
   * retries a 429'd file once (honouring Retry-After) before giving up.
   *
   * F-178: `prepareImageForUpload` downscales/re-encodes each file in the
   * browser first — see src/lib/media/prepare-upload.ts and
   * ProductImageGallery's identical fix for the full rationale (Vercel's
   * 4.5MB request-body limit vs. an ordinary phone photo).
   *
   * F-365: a failure's `message` now comes from the server's own JSON body
   * (via uploadErrorMessage) instead of a fixed "Upload failed" string.
   */
  async function onUploadFiles(files: FileList) {
    setUploading(true);
    setNotice(null);

    try {
      const outcomes = await uploadFilesSequentially(Array.from(files), async (file) => {
        const prepared = await prepareImageForUpload(file);
        const form = new FormData();
        form.append("file", prepared);
        form.append("usage", "PRODUCT");
        return fetch("/api/admin/media", { method: "POST", body: form });
      });

      const failures: { file: File; message: string }[] = [];

      for (const { file, response, retriedAfterRateLimit } of outcomes) {
        if (response.status === 503) {
          failures.push({ file, message: "Image storage isn't configured yet — ask an admin to set up Cloudflare R2." });
          continue;
        }
        if (!response.ok) {
          failures.push({
            file,
            message:
              response.status === 429 && retriedAfterRateLimit
                ? "Still being rate limited after waiting — try again shortly"
                : await uploadErrorMessage(response),
          });
          continue;
        }
        const body = await response.json().catch(() => null);
        if (typeof body?.asset?.id !== "string" || typeof body?.asset?.url !== "string") {
          failures.push({ file, message: "Unexpected response from the server" });
          continue;
        }
        commit(addStagedImage(latestImages.current, { mediaAssetId: body.asset.id, url: body.asset.url, alt: aiFields.name ?? "", color: null, origin: "new" }));
      }

      const uploadNotice = summarizeFailuresByMessage(failures);
      if (uploadNotice) setNotice(uploadNotice);
    } finally {
      // F-178: previously not in a finally, so a thrown error (a network
      // failure, a malformed response body) left "Uploading…" stuck.
      setUploading(false);
    }
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
    commit(addStagedImages(latestImages.current, selected.map((c) => ({ mediaAssetId: c.id, url: c.url, alt: aiFields.name ?? "", color: null, origin: "new" as const }))));
    setCandidates([]);
  }

  /** F-07 (docs/audit-2026-09-19/admin-ux.md): picking an existing library
   * asset never duplicates it — it's already a persisted `MediaAsset`, so
   * staging it is exactly the same "point at this id" bookkeeping as
   * staging a freshly generated candidate above, just tagged `origin:
   * "library"` so `remove()` below knows not to delete it.
   *
   * F-192: takes the whole multi-select batch and stages it with a single
   * `commit` — see stageLibraryAssets in staged-images.ts for why one call
   * per picked asset would keep only the last one. It builds on the
   * latest-state ref (F-358), not the `images` prop, so an upload that
   * finishes while the picker is open is not dropped. */
  function addLibraryAssets(assets: { id: string; url: string; alt: string | null }[]) {
    commit(stageLibraryAssets(latestImages.current, assets, aiFields.name ?? ""));
    setPickerOpen(false);
  }

  async function remove(mediaAssetId: string) {
    const staged = latestImages.current.find((img) => img.mediaAssetId === mediaAssetId);
    // A library-picked asset is only ever *unstaged* here, never deleted —
    // it may already be attached to other products, or just belongs in the
    // library regardless of this draft (see StagedImage.origin's doc
    // comment in staged-images.ts). Only a photo *this session* freshly
    // uploaded/generated is actually removed from storage on "Remove".
    if (staged?.origin === "library") {
      commit(removeStagedImage(latestImages.current, mediaAssetId));
      return;
    }
    setRemovingId(mediaAssetId);
    setNotice(null);
    let response: Response;
    try {
      response = await fetch(`/api/admin/media/${mediaAssetId}`, { method: "DELETE" });
    } catch {
      setRemovingId(null);
      setNotice("Couldn't reach the server — check your connection and try again.");
      return;
    }
    setRemovingId(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setNotice(body?.error ?? "Couldn't remove that image — try again.");
      return;
    }
    commit(removeStagedImage(latestImages.current, mediaAssetId));
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
        {/* F-07 (docs/audit-2026-09-19/admin-ux.md): the new-product form
            can now pick an already-uploaded/generated photo too, not just
            upload a fresh one — same picker as the saved-product gallery. */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40"
        >
          Browse library
        </button>
      </div>

      {pickerOpen && (
        <MediaLibraryBrowser
          title="Choose product images"
          defaultUsage="PRODUCT"
          multiple
          onClose={() => setPickerOpen(false)}
          onSelect={(asset) => addLibraryAssets([asset])}
          onSelectMany={addLibraryAssets}
        />
      )}

      <div className="space-y-2 rounded-xl border border-border bg-surface-muted p-3">
        <p className="text-xs font-semibold text-muted">Generate with AI</p>
        <textarea
          value={promptOverride}
          onChange={(e) => setPromptOverride(e.target.value)}
          rows={2}
          placeholder="Optional prompt override — leave blank to auto-fill from name, category, gender and fabric"
          aria-label="Image generation prompt override"
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
            <div
              key={img.mediaAssetId}
              onDragOver={(event) => {
                if (dragIndex === null) return;
                event.preventDefault();
                if (overIndex !== index) setOverIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragIndex;
                setDragIndex(null);
                setOverIndex(null);
                if (from !== null && from !== index) commit(moveArrayItem(latestImages.current, from, index));
              }}
              className={cn(
                "space-y-2 rounded-xl border border-border p-2 transition",
                overIndex === index && dragIndex !== null && dragIndex !== index && "outline outline-2 outline-offset-2 outline-brand",
              )}
            >
              <div className="relative aspect-square overflow-hidden rounded-lg bg-lavender/40">
                <Image src={img.url} alt={img.alt ?? ""} fill className="object-cover" sizes="200px" />
                {/* F-06 (docs/audit-2026-09-19/admin-ux.md): drag handle —
                    mouse/touch only; the ↑/↓ buttons stay the
                    keyboard-and-screen-reader-accessible fallback. */}
                <span
                  aria-hidden="true"
                  title="Drag to reorder"
                  draggable
                  onDragStart={(event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", img.mediaAssetId);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  className="absolute left-1.5 top-1.5 cursor-grab touch-none rounded-md bg-surface/90 p-1 text-muted shadow-sm active:cursor-grabbing"
                >
                  <GripVertical size={14} />
                </span>
              </div>
              <select
                value={img.color ?? ""}
                onChange={(e) => commit(updateStagedImage(latestImages.current, img.mediaAssetId, { color: e.target.value || null }))}
                aria-label={`Colour tag for image ${index + 1}`}
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
                onChange={(e) => commit(updateStagedImage(latestImages.current, img.mediaAssetId, { alt: e.target.value }))}
                placeholder="Alt text"
                aria-label={`Alt text for image ${index + 1}`}
                maxLength={MAX_ALT_LENGTH}
                className="w-full rounded border border-border p-1 text-xs"
              />
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => commit(moveStagedImage(latestImages.current, img.mediaAssetId, "up"))}
                    aria-label="Move image up"
                    className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === images.length - 1}
                    onClick={() => commit(moveStagedImage(latestImages.current, img.mediaAssetId, "down"))}
                    aria-label="Move image down"
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
