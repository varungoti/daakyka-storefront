"use client";

import type { TryOnGender } from "@/lib/outfit/types";
import { cn } from "@/lib/utils";
import { UserRound } from "lucide-react";

interface GenderModelToggleProps {
  gender: TryOnGender;
  onGenderChange: (gender: TryOnGender) => void;
  className?: string;
}

export function GenderModelToggle({ gender, onGenderChange, className }: GenderModelToggleProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-2", className)}>
      {(["female", "male"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onGenderChange(value)}
          aria-pressed={gender === value}
          className={cn(
            "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold capitalize transition",
            gender === value
              ? "border-brand bg-brand text-white shadow-sm shadow-brand/25"
              : "border-border bg-white text-muted hover:border-brand/30 hover:text-ink",
          )}
        >
          <UserRound size={16} />
          {value}
        </button>
      ))}
    </div>
  );
}
