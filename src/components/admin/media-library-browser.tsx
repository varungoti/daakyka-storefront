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
  onClose,
  onSelect,
}: {
  title?: string;
  /** Pre-selects the usage filter (e.g. "PRODUCT" from the product
   * gallery) — still changeable by the admin, since a photo shot for one
   * use (say a category tile) is often perfectly reusable for another. */
  defaultUsage?: string;
  onClose: () => void;
  onSelect: (asset: { id: string; url: string; alt: string | null }) => void;
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
  const requestIdRef = useRef(0);

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
      setError("Couldn't load the media library — try again.");
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
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect({ id: asset.id, url: asset.url, alt: asset.alt })}
                title={usageSummary(asset)}
                className="group space-y-1 text-left"
              >
                <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-lavender/40 transition group-hover:ring-2 group-hover:ring-brand">
                  <Image src={asset.url} alt={asset.alt ?? ""} fill sizes="150px" className="object-cover" />
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
            ))}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted">
          <span>
            {loading ? "Loading…" : `Showing ${assets.length} of ${total}`}
          </span>
          {!loading && assets.length < total ? (
            <button type="button" onClick={() => load(assets.length)} className="rounded-full border border-border px-3 py-1.5 font-semibold text-ink hover:bg-lilac/40">
              Load more
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
