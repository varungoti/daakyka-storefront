"use client";

import {
  BottomStyleIcon,
  FabricIcon,
  TopStyleIcon,
} from "@/components/mix-match/style-icons";
import { Button } from "@/components/ui/button";
import type { BottomStyle, FabricChoice, TopStyle } from "@/data/mix-match";
import {
  bottomStyleOptions,
  fabricOptions,
  mixMatchColors,
  mixMatchSizes,
  topStyleOptions,
} from "@/data/mix-match";
import { cn } from "@/lib/utils";
import { Check, Layers, Palette, Shirt, Sparkles, Type } from "lucide-react";
import { useState } from "react";

export type MixMatchTab = "top" | "bottom" | "fabric" | "color" | "personalize";

interface MixMatchControlsProps {
  topStyle: TopStyle;
  bottomStyle: BottomStyle;
  fabric: FabricChoice;
  color: string;
  size?: string;
  embroideryName: string;
  onTopChange: (id: TopStyle) => void;
  onBottomChange: (id: BottomStyle) => void;
  onFabricChange: (id: FabricChoice) => void;
  onColorChange: (name: string) => void;
  onSizeChange?: (size: string) => void;
  onEmbroideryChange: (name: string) => void;
  showSize?: boolean;
  layout?: "tabs" | "studio";
}

const tabs: { id: MixMatchTab; label: string; icon: typeof Shirt }[] = [
  { id: "top", label: "Top", icon: Shirt },
  { id: "bottom", label: "Bottom", icon: Layers },
  { id: "fabric", label: "Fabric", icon: Sparkles },
  { id: "color", label: "Color", icon: Palette },
  { id: "personalize", label: "Name", icon: Type },
];

export function MixMatchControls({
  topStyle,
  bottomStyle,
  fabric,
  color,
  size = "M",
  embroideryName,
  onTopChange,
  onBottomChange,
  onFabricChange,
  onColorChange,
  onSizeChange,
  onEmbroideryChange,
  showSize = false,
  layout = "tabs",
}: MixMatchControlsProps) {
  const [activeTab, setActiveTab] = useState<MixMatchTab>("top");

  if (layout === "studio") {
    return (
      <div className="mix-match-panel space-y-6 rounded-[1.75rem] border border-border bg-white/95 p-5 shadow-[0_20px_60px_rgba(91,46,255,0.08)] backdrop-blur-md">
        <StudioSection title="1. Choose Top Style" subtitle="Select your neckline silhouette">
          <StyleGrid>
            {topStyleOptions.map((option) => (
              <StyleTile
                key={option.id}
                label={option.label}
                selected={topStyle === option.id}
                onClick={() => onTopChange(option.id)}
                icon={<TopStyleIcon style={option.id} className="text-brand" />}
              />
            ))}
          </StyleGrid>
        </StudioSection>

        <StudioSection title="2. Choose Bottom Style" subtitle="Pick your preferred pant cut">
          <StyleGrid>
            {bottomStyleOptions.map((option) => (
              <StyleTile
                key={option.id}
                label={option.label}
                selected={bottomStyle === option.id}
                onClick={() => onBottomChange(option.id)}
                icon={<BottomStyleIcon style={option.id} className="text-brand" />}
              />
            ))}
          </StyleGrid>
        </StudioSection>

        <StudioSection title="3. Choose Fabric" subtitle="Performance tech for your shift">
          <StyleGrid>
            {fabricOptions.map((option) => (
              <StyleTile
                key={option.id}
                label={option.label}
                selected={fabric === option.id}
                onClick={() => onFabricChange(option.id)}
                icon={<FabricIcon fabric={option.id} className="text-brand" />}
              />
            ))}
          </StyleGrid>
        </StudioSection>

        <StudioSection title="Choose Color" subtitle="Tap a swatch to update preview">
          <ColorSwatches color={color} onColorChange={onColorChange} />
          {showSize && onSizeChange && (
            <SizePicker size={size} onSizeChange={onSizeChange} className="mt-5 border-t border-border pt-5" />
          )}
        </StudioSection>

        <StudioSection title="Personalize" subtitle="Add embroidery to make it yours">
          <PersonalizeBlock embroideryName={embroideryName} onEmbroideryChange={onEmbroideryChange} />
        </StudioSection>
      </div>
    );
  }

  return (
    <div className="mix-match-panel flex gap-3 rounded-[1.75rem] border border-border bg-white/95 p-4 shadow-[0_20px_60px_rgba(91,46,255,0.08)] backdrop-blur-md md:gap-4 md:p-5">
      <div className="flex shrink-0 flex-col gap-1.5">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            title={label}
            onClick={() => setActiveTab(id)}
            className={cn(
              "flex h-11 w-11 flex-col items-center justify-center rounded-xl transition-all md:h-12 md:w-12",
              activeTab === id
                ? "bg-brand text-white shadow-md shadow-brand/30"
                : "bg-lavender/60 text-muted hover:bg-lilac hover:text-brand",
            )}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>

      <div className="min-w-0 flex-1 space-y-4">
        {activeTab === "top" && (
          <OptionSection title="1. Choose Top Style" subtitle="Select your neckline silhouette">
            <div className="grid grid-cols-2 gap-2.5">
              {topStyleOptions.map((option) => (
                <StyleTile
                  key={option.id}
                  label={option.label}
                  selected={topStyle === option.id}
                  onClick={() => onTopChange(option.id)}
                  icon={<TopStyleIcon style={option.id} className="text-brand" />}
                />
              ))}
            </div>
          </OptionSection>
        )}

        {activeTab === "bottom" && (
          <OptionSection title="2. Choose Bottom Style" subtitle="Pick your preferred pant cut">
            <div className="grid grid-cols-2 gap-2.5">
              {bottomStyleOptions.map((option) => (
                <StyleTile
                  key={option.id}
                  label={option.label}
                  selected={bottomStyle === option.id}
                  onClick={() => onBottomChange(option.id)}
                  icon={<BottomStyleIcon style={option.id} className="text-brand" />}
                />
              ))}
            </div>
          </OptionSection>
        )}

        {activeTab === "fabric" && (
          <OptionSection title="3. Choose Fabric" subtitle="Performance tech for your shift">
            <div className="grid grid-cols-2 gap-2.5">
              {fabricOptions.map((option) => (
                <StyleTile
                  key={option.id}
                  label={option.label}
                  selected={fabric === option.id}
                  onClick={() => onFabricChange(option.id)}
                  icon={<FabricIcon fabric={option.id} className="text-brand" />}
                />
              ))}
            </div>
          </OptionSection>
        )}

        {activeTab === "color" && (
          <OptionSection title="Choose Color" subtitle="Tap a swatch to update preview">
            <ColorSwatches color={color} onColorChange={onColorChange} />
            <p className="mt-3 text-sm font-medium text-ink">{color}</p>

            {showSize && onSizeChange && (
              <SizePicker size={size} onSizeChange={onSizeChange} className="mt-5 border-t border-border pt-5" />
            )}
          </OptionSection>
        )}

        {activeTab === "personalize" && (
          <OptionSection title="Personalize" subtitle="Add embroidery to make it yours">
            <PersonalizeBlock embroideryName={embroideryName} onEmbroideryChange={onEmbroideryChange} />
          </OptionSection>
        )}
      </div>
    </div>
  );
}

function StudioSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border/70 pb-6 last:border-b-0 last:pb-0">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">{title}</p>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StyleGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>;
}

function ColorSwatches({
  color,
  onColorChange,
}: {
  color: string;
  onColorChange: (name: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap gap-3">
        {mixMatchColors.map((c) => (
          <button
            key={c.name}
            type="button"
            title={c.name}
            onClick={() => onColorChange(c.name)}
            className={cn(
              "group relative h-11 w-11 rounded-full border-2 transition-all",
              color === c.name
                ? "scale-110 border-brand shadow-md shadow-brand/25"
                : "border-white hover:scale-105 hover:border-brand/40",
            )}
            style={{ backgroundColor: c.hex }}
          >
            {color === c.name && (
              <span className="absolute inset-0 flex items-center justify-center">
                <Check size={16} className="text-white drop-shadow" />
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm font-medium text-ink">{color}</p>
    </>
  );
}

function SizePicker({
  size,
  onSizeChange,
  className,
}: {
  size: string;
  onSizeChange: (size: string) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">Size</p>
      <div className="flex flex-wrap gap-2">
        {mixMatchSizes.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSizeChange(s)}
            className={cn(
              "min-w-[44px] rounded-xl border px-3 py-2 text-sm font-semibold transition",
              size === s
                ? "border-brand bg-brand text-white shadow-sm"
                : "border-border hover:border-brand/40",
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function PersonalizeBlock({
  embroideryName,
  onEmbroideryChange,
}: {
  embroideryName: string;
  onEmbroideryChange: (name: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-brand/25 bg-lilac/25 p-4">
      <label htmlFor="embroidery-name" className="text-xs font-bold uppercase tracking-wide text-brand">
        Embroidery Name
      </label>
      <input
        id="embroidery-name"
        type="text"
        value={embroideryName}
        onChange={(e) => onEmbroideryChange(e.target.value)}
        placeholder="Dr. Alex Johnson"
        className="mt-3 w-full rounded-xl border border-border bg-white px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
      <Button variant="outline" size="sm" className="mt-3 w-full" type="button">
        <Sparkles size={16} />
        Add Logo
      </Button>
    </div>
  );
}

function OptionSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">{title}</p>
      <p className="mt-1 text-sm text-muted">{subtitle}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function StyleTile({
  label,
  selected,
  onClick,
  icon,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex flex-col items-center gap-2 rounded-2xl border px-3 py-4 text-center transition-all",
        selected
          ? "border-brand bg-brand/5 shadow-[0_0_0_1px_rgba(91,46,255,0.2)]"
          : "border-border bg-white hover:border-brand/35 hover:bg-lavender/40",
      )}
    >
      {selected && (
        <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
          <Check size={12} />
        </span>
      )}
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-xl",
          selected ? "bg-brand/10" : "bg-lilac/50",
        )}
      >
        {icon}
      </div>
      <span className={cn("text-xs font-semibold", selected ? "text-brand" : "text-ink")}>
        {label}
      </span>
    </button>
  );
}
