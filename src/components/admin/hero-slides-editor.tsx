"use client";

import { useState, type DragEventHandler } from "react";
import Image from "next/image";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { MediaLibraryBrowser } from "@/components/admin/media-library-browser";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes";
import { isDirty } from "@/lib/admin/is-dirty";
import { moveArrayItem } from "@/lib/admin/reorder";
import { formatApiError } from "@/lib/validation/format-api-error";
import type { HeroSlideContent, HeroSlidesContent } from "@/lib/homepage";
import { cn } from "@/lib/utils";

type ImageSlot = "image" | "secondaryImage";

function newSlideId(): string {
  // crypto.randomUUID() is available in every browser this admin panel
  // supports (client component). This is a client-generated identifier
  // for React keys and reorder identity only — see heroSlideSchema's doc
  // comment in src/lib/validation/schemas.ts — never a DB row id.
  return `slide-${crypto.randomUUID()}`;
}

function blankSlide(): HeroSlideContent {
  return {
    id: newSlideId(),
    enabled: true,
    eyebrow: "",
    headline: "",
    subheadline: "",
    description: "",
    primaryCta: { label: "Shop Now", href: "/shop" },
    secondaryCta: { label: "Learn More", href: "/for-hospitals" },
    image: null,
    secondaryImage: null,
  };
}

/** Text field error lookup path — must match how the server-side Zod
 * issues' `path.join(".")` comes back through formatApiError (see
 * src/lib/validation/format-api-error.ts), e.g. "slides.0.primaryCta.href". */
function fieldPath(index: number, ...rest: string[]): string {
  return ["slides", String(index), ...rest].join(".");
}

function SlideImagePicker({
  label,
  value,
  onPick,
  onRemove,
  pickerOpen,
  onOpenPicker,
  onClosePicker,
}: {
  label: string;
  value: HeroSlideContent["image"];
  onPick: (asset: { id: string; url: string; alt: string | null }) => void;
  onRemove: () => void;
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onClosePicker: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="flex items-center gap-3">
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-border bg-lavender/40">
          {value ? (
            <Image src={value.url} alt={value.alt ?? ""} fill className="object-cover" sizes="96px" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-muted">No image</div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* F-07 (docs/audit-2026-09-19/admin-ux.md): reuse an existing
              MediaAsset — MediaLibraryBrowser's own onSelect contract
              guarantees this never re-uploads or duplicates the R2 object.
              Deliberately no "Upload new" here: a hero slide image is
              always picked from what's already in the library. */}
          <button
            type="button"
            onClick={onOpenPicker}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40"
          >
            Choose from library
          </button>
          {value ? (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-red-50 hover:text-red-600"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {pickerOpen && (
        <MediaLibraryBrowser
          title={`Choose ${label.toLowerCase()}`}
          defaultUsage="BANNER"
          onClose={onClosePicker}
          onSelect={(asset) => {
            onPick(asset);
            onClosePicker();
          }}
        />
      )}
    </div>
  );
}

function SlideCard({
  slide,
  index,
  total,
  fieldErrors,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
  dragProps,
}: {
  slide: HeroSlideContent;
  index: number;
  total: number;
  fieldErrors: Record<string, string>;
  onChange: (patch: Partial<HeroSlideContent>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (direction: "up" | "down") => void;
  dragProps: {
    onDragOver: DragEventHandler<HTMLDivElement>;
    onDrop: DragEventHandler<HTMLDivElement>;
    highlighted: boolean;
    onDragStart: DragEventHandler<HTMLSpanElement>;
    onDragEnd: DragEventHandler<HTMLSpanElement>;
  };
}) {
  const [openPicker, setOpenPicker] = useState<ImageSlot | null>(null);
  const err = (...path: string[]) => fieldErrors[fieldPath(index, ...path)];

  return (
    <div
      onDragOver={dragProps.onDragOver}
      onDrop={dragProps.onDrop}
      className={cn(
        "space-y-4 rounded-2xl border border-border bg-surface p-5 transition",
        dragProps.highlighted && "outline outline-2 outline-offset-2 outline-brand",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            title="Drag to reorder"
            draggable
            onDragStart={dragProps.onDragStart}
            onDragEnd={dragProps.onDragEnd}
            className="cursor-grab touch-none rounded-md p-1 text-muted active:cursor-grabbing"
          >
            <GripVertical size={16} />
          </span>
          <p className="text-sm font-bold text-ink">Slide {index + 1}</p>
          <label className="ml-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <input
              type="checkbox"
              checked={slide.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
            />
            Enabled
          </label>
        </div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove("up")}
            aria-label={`Move slide ${index + 1} up`}
            className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => onMove("down")}
            aria-label={`Move slide ${index + 1} down`}
            className="rounded border border-border px-1.5 py-0.5 disabled:opacity-30"
          >
            ↓
          </button>
          <button type="button" onClick={onDuplicate} className="rounded-full border border-border px-3 py-1 font-semibold text-ink hover:bg-lilac/40">
            Duplicate
          </button>
          <button type="button" onClick={onRemove} className="rounded-full border border-border px-3 py-1 font-semibold text-red-600 hover:bg-red-50">
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink">Eyebrow</label>
          <input
            value={slide.eyebrow}
            onChange={(e) => onChange({ eyebrow: e.target.value })}
            aria-invalid={Boolean(err("eyebrow"))}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {err("eyebrow") ? <p className="mt-1 text-[11px] font-medium text-red-600">{err("eyebrow")}</p> : null}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink">Headline</label>
          <input
            value={slide.headline}
            onChange={(e) => onChange({ headline: e.target.value })}
            aria-invalid={Boolean(err("headline"))}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {err("headline") ? <p className="mt-1 text-[11px] font-medium text-red-600">{err("headline")}</p> : null}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-ink">Subheadline</label>
          <input
            value={slide.subheadline}
            onChange={(e) => onChange({ subheadline: e.target.value })}
            aria-invalid={Boolean(err("subheadline"))}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {err("subheadline") ? <p className="mt-1 text-[11px] font-medium text-red-600">{err("subheadline")}</p> : null}
        </div>
        <div className="md:row-span-2">
          <label className="mb-1.5 block text-xs font-semibold text-ink">Description</label>
          <textarea
            value={slide.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={4}
            aria-invalid={Boolean(err("description"))}
            className="w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {err("description") ? <p className="mt-1 text-[11px] font-medium text-red-600">{err("description")}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2 rounded-xl border border-border p-3">
          <legend className="px-1 text-xs font-bold text-ink">Primary CTA</legend>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Label</label>
            <input
              value={slide.primaryCta.label}
              onChange={(e) => onChange({ primaryCta: { ...slide.primaryCta, label: e.target.value } })}
              aria-invalid={Boolean(err("primaryCta", "label"))}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
            {err("primaryCta", "label") ? <p className="mt-1 text-[11px] font-medium text-red-600">{err("primaryCta", "label")}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Link</label>
            <input
              value={slide.primaryCta.href}
              onChange={(e) => onChange({ primaryCta: { ...slide.primaryCta, href: e.target.value } })}
              placeholder="/shop or https://example.com"
              aria-invalid={Boolean(err("primaryCta", "href"))}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
            {err("primaryCta", "href") ? <p className="mt-1 text-[11px] font-medium text-red-600">{err("primaryCta", "href")}</p> : null}
          </div>
        </fieldset>
        <fieldset className="space-y-2 rounded-xl border border-border p-3">
          <legend className="px-1 text-xs font-bold text-ink">Secondary CTA</legend>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Label</label>
            <input
              value={slide.secondaryCta.label}
              onChange={(e) => onChange({ secondaryCta: { ...slide.secondaryCta, label: e.target.value } })}
              aria-invalid={Boolean(err("secondaryCta", "label"))}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
            {err("secondaryCta", "label") ? <p className="mt-1 text-[11px] font-medium text-red-600">{err("secondaryCta", "label")}</p> : null}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted">Link</label>
            <input
              value={slide.secondaryCta.href}
              onChange={(e) => onChange({ secondaryCta: { ...slide.secondaryCta, href: e.target.value } })}
              placeholder="/for-hospitals or https://example.com"
              aria-invalid={Boolean(err("secondaryCta", "href"))}
              className="w-full rounded-lg border border-border px-2 py-1.5 text-sm outline-none focus:border-brand"
            />
            {err("secondaryCta", "href") ? <p className="mt-1 text-[11px] font-medium text-red-600">{err("secondaryCta", "href")}</p> : null}
          </div>
        </fieldset>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SlideImagePicker
          label="Main image"
          value={slide.image}
          pickerOpen={openPicker === "image"}
          onOpenPicker={() => setOpenPicker("image")}
          onClosePicker={() => setOpenPicker(null)}
          onPick={(asset) => onChange({ image: { assetId: asset.id, url: asset.url, alt: asset.alt ?? "" } })}
          onRemove={() => onChange({ image: null })}
        />
        <SlideImagePicker
          label="Secondary image"
          value={slide.secondaryImage}
          pickerOpen={openPicker === "secondaryImage"}
          onOpenPicker={() => setOpenPicker("secondaryImage")}
          onClosePicker={() => setOpenPicker(null)}
          onPick={(asset) => onChange({ secondaryImage: { assetId: asset.id, url: asset.url, alt: asset.alt ?? "" } })}
          onRemove={() => onChange({ secondaryImage: null })}
        />
      </div>
    </div>
  );
}

export function HeroSlidesEditor({ initialContent }: { initialContent: HeroSlidesContent }) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // F-13: same unsaved-changes protection as every other admin form (see
  // src/components/admin/homepage-editor.tsx's identical pattern).
  const [initialSnapshot, setInitialSnapshot] = useState(content);
  const dirty = isDirty(content, initialSnapshot);
  useUnsavedChangesGuard(dirty);

  function updateSlide(id: string, patch: Partial<HeroSlideContent>) {
    setContent((prev) => ({
      ...prev,
      slides: prev.slides.map((slide) => (slide.id === id ? { ...slide, ...patch } : slide)),
    }));
  }

  function addSlide() {
    setContent((prev) => ({ ...prev, slides: [...prev.slides, blankSlide()] }));
  }

  function duplicateSlide(index: number) {
    setContent((prev) => {
      const next = prev.slides.slice();
      next.splice(index + 1, 0, { ...prev.slides[index], id: newSlideId() });
      return { ...prev, slides: next };
    });
  }

  function removeSlide(id: string) {
    setContent((prev) => ({ ...prev, slides: prev.slides.filter((slide) => slide.id !== id) }));
  }

  function moveSlide(from: number, to: number) {
    setContent((prev) => ({ ...prev, slides: moveArrayItem(prev.slides, from, to) }));
  }

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});
    const response = await fetch("/api/admin/homepage/hero-slides", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(content),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const { summary, fieldErrors: fe } = formatApiError(body, "Save failed.");
      setStatus("error");
      setErrorMessage(summary);
      setFieldErrors(fe);
      return;
    }

    setInitialSnapshot(content);
    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  };

  return (
    <div className="space-y-6 rounded-3xl border border-border bg-surface p-6">
      <div>
        <h2 className="font-display text-xl font-bold text-ink">Hero Carousel Slides</h2>
        <p className="text-sm text-muted">
          Add, edit, reorder, and enable/disable slides for the homepage hero. Each slide reuses the same
          elements as the classic Hero Section above (eyebrow, headline, subheadline, description, two CTAs,
          and up to two images). Once at least one slide here is enabled, these slides replace the Hero
          Section above on the storefront — the Hero Section&apos;s Rating Label still appears as a trust
          badge beneath every slide. Leave every slide disabled (or the list empty) to keep showing the
          classic single Hero Section.
        </p>
      </div>

      <div className="max-w-xs">
        <label htmlFor="hero-slides-interval" className="mb-1.5 block text-sm font-semibold text-ink">
          Auto-advance interval (seconds)
        </label>
        <input
          id="hero-slides-interval"
          type="number"
          min={2}
          max={60}
          value={Math.round(content.autoAdvanceMs / 1000)}
          onChange={(e) => {
            const seconds = Number(e.target.value);
            if (Number.isFinite(seconds)) {
              setContent((prev) => ({ ...prev, autoAdvanceMs: Math.round(seconds * 1000) }));
            }
          }}
          aria-invalid={Boolean(fieldErrors.autoAdvanceMs)}
          className="w-full rounded-xl border border-border px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        {fieldErrors.autoAdvanceMs ? (
          <p className="mt-1 text-[11px] font-medium text-red-600">{fieldErrors.autoAdvanceMs}</p>
        ) : null}
      </div>

      {content.slides.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          No slides yet — the storefront is showing the classic single Hero Section above.
        </p>
      ) : (
        <div className="space-y-4">
          {content.slides.map((slide, index) => (
            <SlideCard
              key={slide.id}
              slide={slide}
              index={index}
              total={content.slides.length}
              fieldErrors={fieldErrors}
              onChange={(patch) => updateSlide(slide.id, patch)}
              onRemove={() => removeSlide(slide.id)}
              onDuplicate={() => duplicateSlide(index)}
              onMove={(direction) => moveSlide(index, direction === "up" ? index - 1 : index + 1)}
              dragProps={{
                highlighted: overIndex === index && dragIndex !== null && dragIndex !== index,
                onDragOver: (event) => {
                  if (dragIndex === null) return;
                  event.preventDefault();
                  if (overIndex !== index) setOverIndex(index);
                },
                onDrop: (event) => {
                  event.preventDefault();
                  const from = dragIndex;
                  setDragIndex(null);
                  setOverIndex(null);
                  if (from !== null && from !== index) moveSlide(from, index);
                },
                onDragStart: (event) => {
                  setDragIndex(index);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", slide.id);
                },
                onDragEnd: () => {
                  setDragIndex(null);
                  setOverIndex(null);
                },
              }}
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={addSlide}
        className="rounded-full border border-brand px-4 py-2 text-sm font-semibold text-brand hover:bg-brand/5"
      >
        + Add Slide
      </button>

      <FormErrorBanner message={errorMessage} />

      <div className="flex items-center gap-4 border-t border-border pt-4">
        <Button onClick={save} disabled={status === "saving"}>
          {status === "saving" ? "Saving..." : "Save Slides"}
        </Button>
        {status === "saved" && <span className="text-sm text-trust">Saved successfully</span>}
      </div>
    </div>
  );
}
