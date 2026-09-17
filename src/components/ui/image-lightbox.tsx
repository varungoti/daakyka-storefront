"use client";

import { useFocusTrap } from "@/hooks/use-focus-trap";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";

export interface LightboxImage {
  url: string;
  alt?: string;
}

interface ImageLightboxProps {
  images: LightboxImage[];
  startIndex?: number;
  onClose: () => void;
}

const MAX_SCALE = 3;
const DOUBLE_TAP_ZOOM = 2;
const DOUBLE_TAP_WINDOW_MS = 300;
const SWIPE_THRESHOLD_PX = 60;

/**
 * Phase C4 full-screen product image viewer.
 *
 * API design choice: a plain component mounted conditionally by its
 * parent (`{open && <ImageLightbox .../>}`), not a global hook/context.
 * Every caller (product card, product detail gallery, review photos)
 * already needs local state for "which image index was clicked" and
 * "is it open", so a shared singleton store would just move that state
 * around without simplifying anything — this stays a self-contained,
 * dependency-free component.
 *
 * Reuses useFocusTrap from C2 for focus containment, Escape-to-close and
 * body scroll lock. Adds its own arrow-key and pointer-event handling on
 * top (swipe to change image, pinch to zoom, double-tap/double-click to
 * toggle 1x/2x zoom) since those are specific to the image viewer.
 */
export function ImageLightbox({ images, startIndex = 0, onClose }: ImageLightboxProps) {
  const [index, setIndex] = useState(() => clampIndex(startIndex, images.length));
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const containerRef = useFocusTrap<HTMLDivElement>(true, onClose, { lockScroll: true });

  const goTo = useCallback(
    (next: number) => {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      setIndex(clampIndex(next, images.length));
    },
    [images.length],
  );

  const goPrev = useCallback(() => goTo(index - 1), [goTo, index]);
  const goNext = useCallback(() => goTo(index + 1), [goTo, index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") goPrev();
      else if (event.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goPrev, goNext]);

  // --- Touch/mouse: swipe to change image, pinch to zoom, double-tap to
  // toggle zoom. Kept intentionally simple (no gesture library): track
  // active pointers in a ref, and branch on how many are down.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const pinchStartDistance = useRef<number | null>(null);
  const pinchStartScale = useRef(1);
  const lastTapAt = useRef(0);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      dragStart.current = { x: event.clientX, y: event.clientY };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStartDistance.current = distance(a, b);
      pinchStartScale.current = scale;
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && pinchStartDistance.current) {
      const [a, b] = [...pointers.current.values()];
      const ratio = distance(a, b) / pinchStartDistance.current;
      setScale(clampScale(pinchStartScale.current * ratio));
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const wasSinglePointer = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);

    if (pointers.current.size === 0) {
      pinchStartDistance.current = null;

      if (wasSinglePointer && dragStart.current) {
        const dx = event.clientX - dragStart.current.x;
        const dy = event.clientY - dragStart.current.y;

        if (scale === 1 && Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
          if (dx > 0) goPrev();
          else goNext();
        } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          // A tap/click, not a drag or swipe — check for a double tap to
          // toggle zoom, roughly centered on the tap point.
          const now = Date.now();
          if (now - lastTapAt.current < DOUBLE_TAP_WINDOW_MS) {
            const rect = event.currentTarget.getBoundingClientRect();
            const offsetX = event.clientX - rect.left - rect.width / 2;
            const offsetY = event.clientY - rect.top - rect.height / 2;
            setScale((prev) => {
              if (prev > 1) {
                setTranslate({ x: 0, y: 0 });
                return 1;
              }
              setTranslate({ x: -offsetX / 2, y: -offsetY / 2 });
              return DOUBLE_TAP_ZOOM;
            });
            lastTapAt.current = 0;
          } else {
            lastTapAt.current = now;
          }
        }
      }
      dragStart.current = null;
    }
  };

  const current = images[index] as LightboxImage | undefined;
  if (!current) return null;

  return createPortal(
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex flex-col bg-ink/95 outline-none"
    >
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-medium">
          {index + 1} of {images.length}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close image viewer"
          className="rounded-full p-2 transition hover:bg-white/10"
        >
          <X size={22} />
        </button>
      </div>

      <div
        className="relative flex-1 touch-none select-none overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {images.length > 1 && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous image"
            className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 md:left-4"
          >
            <ChevronLeft size={24} />
          </button>
        )}

        <div className="relative h-full w-full">
          <Image
            src={current.url}
            alt={current.alt ?? `Image ${index + 1} of ${images.length}`}
            fill
            unoptimized={current.url.endsWith(".svg")}
            className="object-contain transition-transform duration-150 ease-out"
            style={{ transform: `scale(${scale}) translate(${translate.x}px, ${translate.y}px)` }}
            sizes="100vw"
            priority
          />
        </div>

        {images.length > 1 && (
          <button
            type="button"
            onClick={goNext}
            aria-label="Next image"
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20 md:right-4"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 py-4">
          {images.map((image, i) => (
            <button
              key={`${image.url}-${i}`}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`View image ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition",
                i === index ? "border-white" : "border-white/30 hover:border-white/60",
              )}
            >
              <Image
                src={image.url}
                alt=""
                fill
                unoptimized={image.url.endsWith(".svg")}
                className="object-cover"
                sizes="56px"
              />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(1, scale));
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
