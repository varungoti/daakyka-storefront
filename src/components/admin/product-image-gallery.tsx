"use client";

import Image from "next/image";
import { useState } from "react";
import { GripVertical } from "lucide-react";
import { moveArrayItem, swapStepsForMove } from "@/lib/admin/reorder";
import { MediaLibraryBrowser } from "@/components/admin/media-library-browser";
import { cn } from "@/lib/utils";

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

  async function attachAsset(assetId: string, altGuess: string) {
    const response = await fetch(`/api/admin/products/${productId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaAssetId: assetId, alt: altGuess }),
    });
    if (!response.ok) {
      setNotice("Couldn't attach image to the product.");
      return;
    }
    const body = await response.json();
    onChange([...images, { id: body.image.id, mediaId: body.image.mediaId, url: body.image.media.url, alt: body.image.alt, color: body.image.color, sortOrder: body.image.sortOrder }]);
  }

  async function onUploadFiles(files: FileList) {
    setUploading(true);
    setNotice(null);
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
      await attachAsset(body.asset.id, aiFields.name ?? "");
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

  async function addSelectedCandidates() {
    const selected = candidates.filter((c) => c.selected);
    for (const candidate of selected) {
      await attachAsset(candidate.id, aiFields.name ?? "");
    }
    setCandidates([]);
  }

  function updateImage(id: string, patch: Partial<ProductImageRow>) {
    onChange(images.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  }

  async function setColor(id: string, color: string) {
    updateImage(id, { color: color || null });
    await fetch(`/api/admin/products/${productId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ color: color || null }),
    });
  }

  async function setAlt(id: string, alt: string) {
    updateImage(id, { alt });
  }

  async function saveAlt(id: string, alt: string) {
    await fetch(`/api/admin/products/${productId}/images/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt: alt || null }),
    });
  }

  async function remove(id: string) {
    await fetch(`/api/admin/products/${productId}/images/${id}`, { method: "DELETE" });
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
          title="Choose a product image"
          defaultUsage="PRODUCT"
          onClose={() => setPickerOpen(false)}
          onSelect={(asset) => {
            setPickerOpen(false);
            void attachAsset(asset.id, asset.alt ?? aiFields.name ?? "");
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
                onChange={(e) => setAlt(img.id, e.target.value)}
                onBlur={(e) => saveAlt(img.id, e.target.value)}
                placeholder="Alt text"
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
