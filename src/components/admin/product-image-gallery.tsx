"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { moveArrayItem, swapStepsForMove } from "@/lib/admin/reorder";
import { summarizeFailuresByMessage, uploadErrorMessage, uploadFilesSequentially } from "@/lib/admin/retryable-upload";
import { prepareImageForUpload } from "@/lib/media/prepare-upload";
import { MediaLibraryBrowser } from "@/components/admin/media-library-browser";
import { cn } from "@/lib/utils";

const MAX_ALT_LENGTH = 300;

export interface ProductImageRow {
  id: string; // ProductImage id
  mediaId: string;
  url: string;
  alt: string | null;
  color: string | null;
  sortOrder: number;
}

interface GeneratedCandidate {
  id: string;
  url: string;
  selected: boolean;
}

export interface AttachImagePick {
  id: string;
  alt: string;
}

/**
 * F-358 fix: threads a local `current` accumulator through `picks` instead
 * of every attach reading the `images` prop fresh — the bug this replaces
 * had `attachAsset` (called once per picked image, e.g. from the old
 * per-candidate loop in `addSelectedCandidates`) do `onChange([...images,
 * row])` on every call, each one rebuilding from the exact same stale,
 * pre-loop `images` prop (a component's props/closures don't change mid-
 * function just because `await` yielded — see staged-product-image-gallery
 * .tsx's `onUploadFiles` for the same fix already applied to its own
 * upload loop). The parent's setState then just overwrote the previous
 * image with the next one, so only the *last* of several picked images
 * actually stuck. Now every attach flow (upload, "Add selected to
 * gallery", multi-pick from the library) folds its whole batch through
 * this single accumulator and calls `onChange` once with the final list.
 *
 * Exported and parameterized on `postAttach` (rather than closing over
 * `fetch`) so the accumulator logic itself is unit-testable without a
 * DOM/network — same pattern as `uploadFilesSequentially` in
 * src/lib/admin/retryable-upload.ts.
 */
export async function attachPicksSequentially(
  picks: AttachImagePick[],
  current: ProductImageRow[],
  postAttach: (pick: AttachImagePick) => Promise<ProductImageRow | null>,
): Promise<{ current: ProductImageRow[]; failureCount: number }> {
  let next = current;
  let failureCount = 0;
  for (const pick of picks) {
    const row = await postAttach(pick);
    if (row === null) {
      failureCount++;
      continue;
    }
    next = [...next, row];
  }
  return { current: next, failureCount };
}

/**
 * Multi-image gallery editor for a product (Phase B1). Unlike
 * `MediaPicker` (a single-value picker used by the category form), this
 * manages an array of `ProductImage` rows directly against the
 * `/api/admin/products/[id]/images*` routes, since each add/remove/reorder
 * is its own persisted row rather than one `imageId` field.
 *
 * Requires a saved product (`productId`) — a brand-new, unsaved product
 * has nothing for a `ProductImage` to reference yet, so the parent form
 * should save a draft first and only render this once an id exists.
 */
export function ProductImageGallery({
  productId,
  images,
  productColors,
  aiFields,
  onChange,
}: {
  productId: string;
  images: ProductImageRow[];
  productColors: string[];
  aiFields: { name?: string; category?: string; gender?: string; fabric?: string };
  onChange: (images: ProductImageRow[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [promptOverride, setPromptOverride] = useState("");
  const [variationCount, setVariationCount] = useState(1);
  const [candidates, setCandidates] = useState<GeneratedCandidate[]>([]);
  const [reordering, setReordering] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // F-366: the last known-*saved* alt text per image id, captured on focus
  // — see saveAlt's doc comment for why a failed save can't just revert to
  // `images` (it already holds the in-progress, unsaved keystrokes by the
  // time a PATCH fails). A ref, not state: writing it must never itself
  // trigger a render.
  const altBackupRef = useRef<Map<string, string | null>>(new Map());

  async function attachAsset(assetId: string, altGuess: string) {
    await attachAssets([{ id: assetId, alt: altGuess }]);
  }

  async function postAttachPick(pick: AttachImagePick): Promise<ProductImageRow | null> {
    const response = await fetch(`/api/admin/products/${productId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaAssetId: pick.id, alt: pick.alt }),
    });
    if (!response.ok) return null;
    const body = await response.json();
    return {
      id: body.image.id,
      mediaId: body.image.mediaId,
      url: body.image.media.url,
      alt: body.image.alt,
      color: body.image.color,
      sortOrder: body.image.sortOrder,
    };
  }

  /** F-192: attaches several picked library images in one call — used by
   * the media picker's "Add N images" multi-select and by "Add selected to
   * gallery" below. See attachPicksSequentially's doc comment (F-358) for
   * why this always folds the whole batch through one accumulator and
   * calls onChange once, rather than once per picked image. */
  async function attachAssets(picks: AttachImagePick[]) {
    const { current, failureCount } = await attachPicksSequentially(picks, images, postAttachPick);
    if (failureCount > 0) {
      setNotice(picks.length > 1 ? "Couldn't attach one or more images to the product." : "Couldn't attach image to the product.");
    }
    if (failureCount < picks.length) {
      onChange(current);
    }
  }

  /**
   * F-324: a 429 from admin-media-upload's 30/minute limiter used to be
   * treated exactly like a bad file — skipped with a single generic "One
   * or more uploads failed.", with no indication of which files didn't
   * make it or that waiting a moment would fix it. uploadFilesSequentially
   * retries a 429'd file once, honouring its Retry-After, before giving
   * up; every distinct failure reason is then reported with the file
   * names it affected instead of a blanket message.
   *
   * F-178: `prepareImageForUpload` downscales/re-encodes each file in the
   * browser before it's posted, so an ordinary 12-50MP phone photo (often
   * 4.5-12MB as a JPEG) fits under Vercel's hard 4.5MB request-body limit
   * for a Function instead of failing in production with a platform-level
   * 413 the app never even sees — see src/lib/media/prepare-upload.ts.
   *
   * F-365: a failure's `message` now comes from the server's own JSON body
   * (via uploadErrorMessage) instead of a fixed "Upload failed" string, so
   * an admin sees *why* (bad file type, too large, ...), same as the
   * customer review form already does.
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

      const attached: AttachImagePick[] = [];
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
        const body = await response.json();
        attached.push({ id: body.asset.id, alt: aiFields.name ?? "" });
      }

      if (attached.length > 0) {
        // Note: this may itself set a notice (e.g. "Couldn't attach one or
        // more images") — only overwrite it below when the upload stage
        // itself also has something to report, so an attach-stage failure
        // isn't silently cleared by an unconditional setNotice(null).
        await attachAssets(attached);
      }
      const uploadNotice = summarizeFailuresByMessage(failures);
      if (uploadNotice) setNotice(uploadNotice);
    } finally {
      // F-178: previously not in a finally, so a thrown error (a network
      // failure `fetch` itself rejects on, a malformed response body) left
      // "Uploading…" stuck forever with no way to retry.
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

  /**
   * F-358 fix: used to loop `attachAsset` once per selected candidate,
   * which is exactly the stale-closure bug attachPicksSequentially's doc
   * comment describes — each call's `onChange([...images, row])` read the
   * same pre-loop `images`, so only the last selected candidate actually
   * stuck. Now the whole selection is one `attachAssets` call, which folds
   * every pick through a single accumulator and calls onChange once.
   */
  async function addSelectedCandidates() {
    const selected = candidates.filter((c) => c.selected);
    await attachAssets(selected.map((c) => ({ id: c.id, alt: aiFields.name ?? "" })));
    setCandidates([]);
  }

  function updateImage(id: string, patch: Partial<ProductImageRow>) {
    onChange(images.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  }

  /** F-366 fix: used to fire-and-forget the PATCH and always keep the
   * optimistic local update, even on failure — a rejected colour tag (or a
   * network error) looked saved but silently reverted on the next reload.
   * Reverts the optimistic update and surfaces a notice when the request
   * doesn't succeed. */
  async function setColor(id: string, color: string) {
    const previous = images.find((img) => img.id === id)?.color ?? null;
    updateImage(id, { color: color || null });
    const response = await fetch(`/api/admin/products/${productId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: color || null }),
    });
    if (!response.ok) {
      updateImage(id, { color: previous });
      setNotice("Couldn't update the colour tag — try again.");
    }
  }

  async function setAlt(id: string, alt: string) {
    updateImage(id, { alt });
  }

  /** F-366 fix: same as setColor above — a failed PATCH (e.g. the >300
   * character server-side cap) used to be silently ignored, leaving the
   * field looking saved until the next reload quietly reverted it.
   * `altBackupRef` (set on focus, below) holds the last known-*saved*
   * value to revert to, since by blur time `images` already reflects
   * whatever the admin just typed, not the last successful save. */
  async function saveAlt(id: string, alt: string) {
    const response = await fetch(`/api/admin/products/${productId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt: alt || null }),
    });
    if (!response.ok) {
      updateImage(id, { alt: altBackupRef.current.get(id) ?? null });
      setNotice("Couldn't save the alt text — try again.");
    }
  }

  /** F-366 fix: used to update the UI unconditionally, even when the
   * DELETE failed — the image looked removed until the next reload brought
   * it back. */
  async function remove(id: string) {
    const response = await fetch(`/api/admin/products/${productId}/images/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setNotice("Couldn't remove that image — try again.");
      return;
    }
    onChange(images.filter((img) => img.id !== id));
  }

  /** Single-step "swap with adjacent sibling" call — shared by the ↑/↓
   * buttons and the drag-and-drop handler below (see
   * src/lib/admin/reorder.ts). */
  async function reorderStep(id: string, direction: "up" | "down"): Promise<boolean> {
    const response = await fetch(`/api/admin/products/${productId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reorder: direction }),
    });
    return response.ok;
  }

  async function move(id: string, direction: "up" | "down") {
    const ok = await reorderStep(id, direction);
    if (ok) {
      const index = images.findIndex((img) => img.id === id);
      const swapWith = direction === "up" ? index - 1 : index + 1;
      if (swapWith >= 0 && swapWith < images.length) {
        const next = images.slice();
        [next[index], next[swapWith]] = [next[swapWith], next[index]];
        onChange(next);
      }
    }
  }

  /** F-06 (docs/audit-2026-09-19/admin-ux.md): drag-and-drop reorder,
   * expressed as a sequence of the same single-step swap the ↑/↓ buttons
   * use (see reorder.ts's doc comment for why that's equivalent to a
   * direct splice-to-position). Sequential and awaited so each step's
   * server-side "swap with current neighbour" logic sees the previous
   * step's result rather than racing. */
  async function reorderByDrag(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const steps = swapStepsForMove(fromIndex, toIndex);
    const id = images[fromIndex].id;
    setReordering(true);
    for (const direction of steps) {
      const ok = await reorderStep(id, direction);
      if (!ok) {
        setNotice("Couldn't reorder — try again.");
        setReordering(false);
        return;
      }
    }
    setReordering(false);
    onChange(moveArrayItem(images, fromIndex, toIndex));
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
        {/* F-07 (docs/audit-2026-09-19/admin-ux.md): reuse an already-
            uploaded/generated photo instead of re-uploading the same image
            for every similar product/colourway. */}
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
          onSelect={(asset) => {
            setPickerOpen(false);
            void attachAsset(asset.id, asset.alt ?? aiFields.name ?? "");
          }}
          onSelectMany={(assets) => {
            setPickerOpen(false);
            void attachAssets(assets.map((asset) => ({ id: asset.id, alt: asset.alt ?? aiFields.name ?? "" })));
          }}
        />
      )}

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
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted">No images yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img, index) => (
            <div
              key={img.id}
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
                if (from !== null) void reorderByDrag(from, index);
              }}
              className={cn(
                "space-y-2 rounded-xl border border-border p-2 transition",
                overIndex === index && dragIndex !== null && dragIndex !== index && "outline outline-2 outline-offset-2 outline-brand",
              )}
            >
              <div className="relative aspect-square overflow-hidden rounded-lg bg-lavender/40">
                <Image src={img.url} alt={img.alt ?? ""} fill className="object-cover" sizes="200px" />
                {/* F-06 (docs/audit-2026-09-19/admin-ux.md): drag handle —
                    mouse/touch only. The ↑/↓ buttons below stay the
                    keyboard-and-screen-reader-accessible fallback, since
                    native drag-and-drop has no keyboard equivalent. */}
                <span
                  aria-hidden="true"
                  title="Drag to reorder"
                  draggable={!reordering}
                  onDragStart={(event) => {
                    setDragIndex(index);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", img.id);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  className={cn(
                    "absolute left-1.5 top-1.5 cursor-grab touch-none rounded-md bg-surface/90 p-1 text-muted shadow-sm active:cursor-grabbing",
                    reordering && "pointer-events-none opacity-40",
                  )}
                >
                  <GripVertical size={14} />
                </span>
              </div>
              <select value={img.color ?? ""} onChange={(e) => setColor(img.id, e.target.value)} className="w-full rounded border border-border p-1 text-xs">
                <option value="">No colour tag</option>
                {productColors.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              <input
                value={img.alt ?? ""}
                onFocus={() => altBackupRef.current.set(img.id, img.alt)}
                onChange={(e) => setAlt(img.id, e.target.value)}
                onBlur={(e) => saveAlt(img.id, e.target.value)}
                placeholder="Alt text"
                maxLength={MAX_ALT_LENGTH}
                className="w-full rounded border border-border p-1 text-xs"
              />
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex gap-1">
                  <button type="button" disabled={index === 0 || reordering} onClick={() => move(img.id, "up")} aria-label="Move image up" className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30">
                    ↑
                  </button>
                  <button type="button" disabled={index === images.length - 1 || reordering} onClick={() => move(img.id, "down")} aria-label="Move image down" className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30">
                    ↓
                  </button>
                </div>
                <button type="button" onClick={() => remove(img.id)} className="text-red-600 hover:underline">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
