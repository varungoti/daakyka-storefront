"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

export interface MediaLibraryAsset {
  id: string;
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  source: "UPLOAD" | "AI";
  usage: string;
  slot: string | null;
  createdAt: string;
  usageInfo: {
    slot: string | null;
    categoryCount: number;
    productCount: number;
    sampleProductNames: string[];
    /** F-064: the asset is picked as a hero carousel slide's image — a
     * snapshotted reference the media library couldn't previously see, so
     * an in-use hero image showed here as "Not used anywhere yet". */
    isHeroSlide: boolean;
  };
}

const USAGE_OPTIONS = [
  { value: "", label: "Any usage" },
  { value: "PRODUCT", label: "Product" },
  { value: "CATEGORY", label: "Category" },
  { value: "BANNER", label: "Banner" },
  { value: "SECTION", label: "Section" },
  { value: "BLOG", label: "Blog" },
  { value: "AVATAR", label: "Avatar" },
  { value: "REVIEW", label: "Review" },
];

const SOURCE_OPTIONS = [
  { value: "", label: "Any source" },
  { value: "UPLOAD", label: "Uploaded" },
  { value: "AI", label: "AI-generated" },
];

const DATE_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function usageSummary(asset: MediaLibraryAsset): string {
  const parts: string[] = [];
  if (asset.usageInfo.slot) parts.push("Site slot");
  if (asset.usageInfo.isHeroSlide) parts.push("Hero slide");
  if (asset.usageInfo.categoryCount > 0) parts.push(`${asset.usageInfo.categoryCount} categor${asset.usageInfo.categoryCount === 1 ? "y" : "ies"}`);
  if (asset.usageInfo.productCount > 0) {
    const names = asset.usageInfo.sampleProductNames;
    const extra = asset.usageInfo.productCount - names.length;
    parts.push(`${names.join(", ")}${extra > 0 ? ` +${extra} more` : ""}`);
  }
  return parts.length > 0 ? `Used: ${parts.join(" · ")}` : "Not used anywhere yet";
}

/**
 * F-07 (docs/audit-2026-09-19/admin-ux.md): general-purpose, searchable/
 * filterable browser over every `MediaAsset` — reuses the existing
 * `saveMediaAsset`/`MediaAsset` model and the (now extended, see
 * src/lib/media/query.ts) `GET /api/admin/media` endpoint rather than a
 * parallel storage concept. Any image field can mount this and pass an
 * `onSelect`; picking an asset here never re-uploads or duplicates the R2
 * object — the caller just gets the existing asset's `id`/`url`/`alt` back
 * and references it (e.g. `POST /api/admin/products/[id]/images` with
 * `mediaAssetId`, exactly like a fresh upload would, just skipping the
 * upload step).
 *
 * Wired in first for the product gallery (product-image-gallery.tsx,
 * staged-product-image-gallery.tsx) per the audit's "the product gallery
 * especially" — nothing about this component is product-specific, so the
 * category form's single-value picker (media-picker.tsx) now opens this
 * for its "Choose existing" path too, and any other image field (a future
 * homepage slot picker, ...) can reuse it the same way.
 */
export function MediaLibraryBrowser({
  title = "Media Library",
  defaultUsage,
  multiple = false,
  onClose,
  onSelect,
  onSelectMany,
}: {
  title?: string;
  /** Pre-selects the usage filter (e.g. "PRODUCT" from the product
   * gallery) — still changeable by the admin, since a photo shot for one
   * use (say a category tile) is often perfectly reusable for another. */
  defaultUsage?: string;
  /** F-192: renders a checkbox on every tile plus an "Add N images"
   * confirm button, instead of picking on the first click — so several
   * library images can be attached in one open/scroll/pick cycle instead
   * of one image per open/close. Requires `onSelectMany`; every existing
   * single-pick caller (the category picker, hero slides, testimonials)
   * is unaffected, since it simply doesn't pass this prop. */
  multiple?: boolean;
  onClose: () => void;
  onSelect: (asset: { id: string; url: string; alt: string | null }) => void;
  /** Called once with every checked asset when "Add N images" is clicked
   * (only relevant when `multiple` is true — ignored otherwise). */
  onSelectMany?: (assets: { id: string; url: string; alt: string | null }[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [usage, setUsage] = useState(defaultUsage ?? "");
  const [source, setSource] = useState("");
  const [dateWindow, setDateWindow] = useState("");
  const [assets, setAssets] = useState<MediaLibraryAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const requestIdRef = useRef(0);

  function toggleSelected(assetId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  function confirmMultiSelect() {
    const chosen = assets
      .filter((asset) => selectedIds.has(asset.id))
      .map((asset) => ({ id: asset.id, url: asset.url, alt: asset.alt }));
    if (chosen.length === 0) return;
    onSelectMany?.(chosen);
  }

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  async function load(offset: number) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "24", offset: String(offset) });
    if (usage) params.set("usage", usage);
    if (source) params.set("source", source);
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (dateWindow) {
      // Computed at fetch time (not memoized on render) — "last N days"
      // is only ever meant to mean N days before whenever the admin
      // actually asked, not a value frozen at some earlier render.
      const days = Number(dateWindow);
      params.set("from", new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
    }

    const response = await fetch(`/api/admin/media?${params}`);
    // Ignore a stale response that resolves after a newer filter change.
    if (requestId !== requestIdRef.current) return;
    setLoading(false);
    if (!response.ok) {
      // F-291: a 403 here means the role genuinely can't browse the
      // library (not a transient failure) — "try again" told an admin to
      // retry something that would never succeed.
      setError(
        response.status === 403
          ? "You don't have access to the media library — ask an admin with Media access."
          : "Couldn't load the media library — try again.",
      );
      return;
    }
    const body = await response.json();
    setAssets((prev) => (offset === 0 ? body.assets : [...prev, ...body.assets]));
    setTotal(body.total ?? 0);
  }

  useEffect(() => {
    // This effect's whole purpose is to (re)fetch whenever a filter
    // changes, including showing a fresh "Loading…" state right away —
    // matching the same documented, established pattern as the product
    // form's debounced slug-availability check (see product-form.tsx).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usage, source, debouncedSearch, dateWindow]);

  return (
    <Modal title={title} onClose={onClose} widthClassName="max-w-4xl">
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search alt text, prompt, or filename…"
            className="rounded-lg border border-border p-2 text-sm sm:col-span-2"
          />
          <select value={usage} onChange={(e) => setUsage(e.target.value)} className="rounded-lg border border-border p-2 text-sm">
            {USAGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-border p-2 text-sm">
            {SOURCE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={dateWindow}
            onChange={(e) => setDateWindow(e.target.value)}
            className="rounded-lg border border-border p-2 text-sm sm:col-start-4"
          >
            {DATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        {!loading && assets.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            No images match these filters yet.
          </p>
        ) : (
          <div className="grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5">
            {assets.map((asset) => {
              const isSelected = selectedIds.has(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  onClick={() =>
                    multiple ? toggleSelected(asset.id) : onSelect({ id: asset.id, url: asset.url, alt: asset.alt })
                  }
                  aria-pressed={multiple ? isSelected : undefined}
                  title={usageSummary(asset)}
                  className="group space-y-1 text-left"
                >
                  <div
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-lg border bg-lavender/40 transition group-hover:ring-2 group-hover:ring-brand",
                      isSelected ? "border-brand ring-2 ring-brand" : "border-border",
                    )}
                  >
                    <Image src={asset.url} alt={asset.alt ?? ""} fill sizes="150px" className="object-cover" />
                    {/* F-192: a checkbox overlay in multi-select mode — the
                        whole tile stays clickable (toggling it), the
                        checkbox is just the visible affordance. */}
                    {multiple && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[11px] font-bold",
                          isSelected ? "border-brand bg-brand text-white" : "border-white bg-black/30 text-transparent",
                        )}
                      >
                        ✓
                      </span>
                    )}
                    <span
                      className={cn(
                        "absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white",
                        asset.source === "AI" ? "bg-purple-600/90" : "bg-ink/70",
                      )}
                    >
                      {asset.source === "AI" ? "AI" : "Upload"}
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-muted">{usageSummary(asset)}</p>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted">
          <span>
            {loading ? "Loading…" : `Showing ${assets.length} of ${total}`}
          </span>
          <div className="flex items-center gap-2">
            {!loading && assets.length < total ? (
              <button type="button" onClick={() => load(assets.length)} className="rounded-full border border-border px-3 py-1.5 font-semibold text-ink hover:bg-lilac/40">
                Load more
              </button>
            ) : null}
            {/* F-192: was one pick per open/close cycle — this lets an
                admin check several library images and attach them all at
                once. */}
            {multiple && (
              <button
                type="button"
                onClick={confirmMultiSelect}
                disabled={selectedIds.size === 0}
                className="rounded-full bg-brand px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add {selectedIds.size} image{selectedIds.size === 1 ? "" : "s"}
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
