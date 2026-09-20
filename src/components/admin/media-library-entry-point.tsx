"use client";

import { useState } from "react";
import { MediaLibraryBrowser } from "@/components/admin/media-library-browser";

/**
 * F-07 (docs/audit-2026-09-19/admin-ux.md): the direct fix for the audit's
 * literal complaint — `/admin/media` was exclusively slot-based cards, with
 * no "browse everything I've uploaded" view anywhere. Opens the same
 * general-purpose browser the product gallery uses (see
 * media-library-browser.tsx); since this page has no single image field to
 * pick *into*, selecting an asset here copies its URL instead, which is
 * still a genuinely useful outcome from a page whose whole purpose is
 * finding an image you already have.
 */
export function MediaLibraryEntryPoint() {
  const [open, setOpen] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
      >
        Browse full library
      </button>
      {copiedNotice ? <span className="text-xs font-medium text-trust">{copiedNotice}</span> : null}

      {open && (
        <MediaLibraryBrowser
          title="Media Library — every uploaded/generated image"
          onClose={() => setOpen(false)}
          onSelect={async (asset) => {
            try {
              await navigator.clipboard.writeText(asset.url);
              setCopiedNotice("Image URL copied.");
            } catch {
              setCopiedNotice(asset.url);
            }
            setOpen(false);
            setTimeout(() => setCopiedNotice(null), 4000);
          }}
        />
      )}
    </div>
  );
}
