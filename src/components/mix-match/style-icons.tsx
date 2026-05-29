import type { ComponentType } from "react";
import type { BottomStyle, FabricChoice, TopStyle } from "@/data/mix-match";
import { cn } from "@/lib/utils";

interface IconProps {
  className?: string;
}

export function VNeckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M14 8h20l-4 10H18L14 8Z" fill="currentColor" opacity="0.25" />
      <path d="M12 18h24v22H12V18Z" fill="currentColor" opacity="0.15" />
      <path d="M18 8l6 12 6-12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 18h20" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function MandarinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M12 18h24v22H12V18Z" fill="currentColor" opacity="0.15" />
      <rect x="14" y="10" width="20" height="8" rx="2" fill="currentColor" opacity="0.25" />
      <path d="M14 18h20" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function RoundNeckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M12 18h24v22H12V18Z" fill="currentColor" opacity="0.15" />
      <path d="M16 12c0-2.2 3.6-4 8-4s8 1.8 8 4" stroke="currentColor" strokeWidth="2" />
      <path d="M14 18h20" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function ZipNeckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M12 18h24v22H12V18Z" fill="currentColor" opacity="0.15" />
      <path d="M24 8v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="8" r="2" fill="currentColor" />
      <path d="M14 18h20" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function JoggerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M16 8h16v14H16V8Z" fill="currentColor" opacity="0.12" />
      <path d="M18 22h12l-2 18h-4l-2-10-2 10h-4l-2-18Z" fill="currentColor" opacity="0.2" />
      <path d="M18 22h12M20 32h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function StraightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M16 8h16v14H16V8Z" fill="currentColor" opacity="0.12" />
      <path d="M18 22h12v18h-4V22h-4v18h-4V22Z" fill="currentColor" opacity="0.2" />
    </svg>
  );
}

export function CargoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M16 8h16v14H16V8Z" fill="currentColor" opacity="0.12" />
      <path d="M18 22h12v18h-12V22Z" fill="currentColor" opacity="0.2" />
      <rect x="28" y="28" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function ShortsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M16 8h16v14H16V8Z" fill="currentColor" opacity="0.12" />
      <path d="M18 22h12v10H18V22Z" fill="currentColor" opacity="0.2" />
      <path d="M18 32h12" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

export function Stretch2WayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M8 24h32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 24l6-6M8 24l6 6M40 24l-6-6M40 24l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Stretch4WayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M24 8v32M8 24h32" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 14l20 20M34 14L14 34" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

export function EcoFlexIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M24 38c8-6 12-12 12-18a8 8 0 10-16 0c0 6 4 12 4 18Z" fill="currentColor" opacity="0.2" />
      <path d="M24 38V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function CoolingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" className={cn("h-10 w-10", className)} fill="none" aria-hidden>
      <path d="M24 8v8M24 32v8M8 24h8M32 24h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="24" r="8" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const topIcons: Record<TopStyle, ComponentType<IconProps>> = {
  "v-neck": VNeckIcon,
  mandarin: MandarinIcon,
  "round-neck": RoundNeckIcon,
  "zip-neck": ZipNeckIcon,
};

const bottomIcons: Record<BottomStyle, ComponentType<IconProps>> = {
  jogger: JoggerIcon,
  straight: StraightIcon,
  cargo: CargoIcon,
  shorts: ShortsIcon,
};

const fabricIcons: Record<FabricChoice, ComponentType<IconProps>> = {
  "2-way-stretch": Stretch2WayIcon,
  "4-way-stretch": Stretch4WayIcon,
  "eco-flex": EcoFlexIcon,
  cooling: CoolingIcon,
};

export function TopStyleIcon({ style, className }: { style: TopStyle; className?: string }) {
  const Icon = topIcons[style];
  return <Icon className={className} />;
}

export function BottomStyleIcon({ style, className }: { style: BottomStyle; className?: string }) {
  const Icon = bottomIcons[style];
  return <Icon className={className} />;
}

export function FabricIcon({ fabric, className }: { fabric: FabricChoice; className?: string }) {
  const Icon = fabricIcons[fabric];
  return <Icon className={className} />;
}
