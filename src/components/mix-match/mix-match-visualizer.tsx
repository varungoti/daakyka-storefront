"use client";

import { GenderModelToggle } from "@/components/mix-match/gender-model-toggle";
import { cn } from "@/lib/utils";
import type { TryOnGender } from "@/lib/outfit/types";
import { RotateCcw } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

function isDataUrl(src: string): boolean {
  return src.startsWith("data:");
}

interface MixMatchVisualizerProps {
  imageSrc: string;
  imageAlt: string;
  topLabel: string;
  bottomLabel: string;
  colorLabel?: string;
  fabricLabel?: string;
  embroideryName?: string;
  tintHex?: string;
  className?: string;
  loading?: boolean;
  modeLabel?: string;
  genderLabel?: string;
  gender?: TryOnGender;
  onGenderChange?: (gender: TryOnGender) => void;
}

export function MixMatchVisualizer({
  imageSrc,
  imageAlt,
  topLabel,
  bottomLabel,
  colorLabel,
  fabricLabel,
  embroideryName,
  tintHex = "#C4B5FD",
  className,
  loading = false,
  modeLabel,
  genderLabel,
  gender,
  onGenderChange,
}: MixMatchVisualizerProps) {
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, rotation: 0 });

  const onPointerDown = (event: React.PointerEvent) => {
    setIsDragging(true);
    dragStart.current = { x: event.clientX, rotation };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!isDragging) return;
    const delta = event.clientX - dragStart.current.x;
    setRotation(dragStart.current.rotation + delta * 0.4);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    setIsDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className={cn("relative", className)}>
      <div className="configurator-stage relative overflow-hidden rounded-[2rem] px-6 pb-8 pt-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_85%,rgba(91,46,255,0.35),transparent_55%)]" />
        <div className="pointer-events-none absolute left-1/2 top-[62%] h-40 w-40 -translate-x-1/2 rounded-full bg-brand/20 blur-3xl" />
        <div className="pointer-events-none absolute left-1/2 top-[38%] h-56 w-56 -translate-x-1/2 rounded-full border border-brand/15 opacity-60" />
        <div className="pointer-events-none absolute left-1/2 top-[44%] h-72 w-72 -translate-x-1/2 rounded-full border border-brand/10 opacity-40" />

        <div
          className="relative mx-auto aspect-[3/4] w-full max-w-[320px] cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ perspective: "1000px" }}
        >
          <div
            className="relative h-full w-full transition-transform duration-100"
            style={{ transform: `rotateY(${rotation}deg)`, transformStyle: "preserve-3d" }}
          >
            <div
              className="absolute inset-0 rounded-[1.5rem] opacity-30"
              style={{ background: `radial-gradient(circle at 50% 20%, ${tintHex}, transparent 70%)` }}
            />
            {isDataUrl(imageSrc) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageSrc}
                alt={imageAlt}
                className={cn(
                  "h-full w-full object-cover object-top drop-shadow-2xl transition-opacity duration-300",
                  loading && "opacity-40",
                )}
                draggable={false}
              />
            ) : (
              <Image
                src={imageSrc}
                alt={imageAlt}
                fill
                className={cn(
                  "object-cover object-top drop-shadow-2xl transition-opacity duration-300",
                  loading && "opacity-40",
                )}
                sizes="320px"
                draggable={false}
                priority
              />
            )}
            {loading && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/30 backdrop-blur-[2px]">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                <p className="text-xs font-semibold uppercase tracking-wide text-brand">
                  Rendering outfit…
                </p>
              </div>
            )}
            {embroideryName && (
              <div className="absolute left-1/2 top-[28%] -translate-x-1/2 rounded-md bg-white/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-brand shadow-sm">
                {embroideryName}
              </div>
            )}
          </div>
        </div>

        <div className="relative mx-auto mt-2 flex max-w-[280px] flex-col items-center">
          <div className="pedestal-ring h-3 w-full rounded-[100%]" />
          <div className="pedestal-surface -mt-1 flex h-12 w-[88%] items-center justify-center rounded-[100%]">
            <RotateCcw size={14} className="text-brand/80" />
            <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-brand/90">
              Drag to Rotate
            </span>
          </div>
        </div>
      </div>

      {gender && onGenderChange && (
        <GenderModelToggle
          gender={gender}
          onGenderChange={onGenderChange}
          className="mt-4 max-w-[320px] mx-auto"
        />
      )}

      <div className="mt-4 rounded-2xl border border-border bg-white/90 p-4 text-center shadow-sm backdrop-blur-sm">
        <p className="font-display text-sm font-bold text-ink">Live Set Preview</p>
        <p className="mt-1 text-xs text-muted">
          {topLabel} + {bottomLabel}
          {colorLabel ? ` · ${colorLabel}` : ""}
          {fabricLabel ? ` · ${fabricLabel}` : ""}
          {genderLabel ? ` · ${genderLabel}` : ""}
        </p>
        {modeLabel && (
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-brand/80">
            {modeLabel}
          </p>
        )}
      </div>
    </div>
  );
}
