"use client";

import { Button } from "@/components/ui/button";
import type { TryOnGender } from "@/lib/outfit/types";
import { cn } from "@/lib/utils";
import { Scan, UserRound } from "lucide-react";

interface AiFitScanPanelProps {
  gender: TryOnGender;
  onGenderChange: (gender: TryOnGender) => void;
  onScan?: () => void;
  scanning?: boolean;
}

export function AiFitScanPanel({
  gender,
  onGenderChange,
  onScan,
  scanning = false,
}: AiFitScanPanelProps) {
  return (
    <div className="rounded-[1.75rem] border border-brand/20 bg-[linear-gradient(180deg,#f3ecff_0%,#ffffff_100%)] p-5 shadow-[0_20px_60px_rgba(91,46,255,0.08)]">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">AI Fit Scan</p>
      <p className="mt-1 text-sm text-muted">Preset avatars for virtual try-on (v1)</p>

      <div className="relative mx-auto mt-5 flex aspect-[3/4] max-h-[220px] w-full items-center justify-center overflow-hidden rounded-2xl border border-brand/15 bg-[radial-gradient(circle_at_50%_30%,rgba(91,46,255,0.18),transparent_60%)]">
        <div className="absolute inset-0 opacity-40">
          <svg viewBox="0 0 120 240" className="mx-auto h-full w-auto text-brand" aria-hidden>
            <path
              d="M60 20c12 0 22 10 22 22s-10 22-22 22-22-10-22-22 10-22 22-22zm-28 58c-8 6-14 16-16 28l-4 24 8 4 6-18c2 22 8 42 14 58l-6 46h36l-6-46c6-16 12-36 14-58l6 18 8-4-4-24c-2-12-8-22-16-28H32z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
          </svg>
        </div>
        <Scan
          className={cn("relative z-10 text-brand/80", scanning && "animate-pulse")}
          size={36}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {(["female", "male"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onGenderChange(value)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize transition",
              gender === value
                ? "border-brand bg-brand text-white"
                : "border-border bg-white text-muted hover:border-brand/30",
            )}
          >
            <UserRound size={16} />
            {value}
          </button>
        ))}
      </div>

      <Button
        className="mt-4 w-full"
        onClick={onScan}
        disabled={scanning}
        type="button"
      >
        <Scan size={16} />
        {scanning ? "Scanning…" : "Scan My Size"}
      </Button>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
      Uses preset models with MediaPipe pose overlay. Custom body upload ships in a later release.
      </p>
    </div>
  );
}
