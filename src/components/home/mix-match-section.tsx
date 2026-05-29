"use client";

import { AiFitScanPanel } from "@/components/mix-match/ai-fit-scan-panel";
import { MixMatchControls } from "@/components/mix-match/mix-match-controls";
import { MixMatchVisualizer } from "@/components/mix-match/mix-match-visualizer";
import { Button } from "@/components/ui/button";
import { scrubMedia } from "@/data/media/catalog";
import {
  defaultMixMatchConfig,
  fabricOptions,
  mixMatchColors,
  topStyleOptions,
  bottomStyleOptions,
  type MixMatchConfig,
} from "@/data/mix-match";
import type { TryOnGender } from "@/lib/outfit/types";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

const checklist = [
  "3D Live Preview",
  "AI Fit Scan",
  "Custom Embroidery",
  "Perfect Fit Guarantee",
];

const previewImages: Record<string, string> = {
  "v-neck": scrubMedia.vNeckLilac,
  mandarin: scrubMedia.mandarinSage,
  "round-neck": scrubMedia.roundWhite,
  "zip-neck": scrubMedia.zipLilac,
};

export function MixMatchSection() {
  const [config, setConfig] = useState<MixMatchConfig>(defaultMixMatchConfig);
  const [gender, setGender] = useState<TryOnGender>("female");
  const [scanning, setScanning] = useState(false);

  const tintHex = mixMatchColors.find((c) => c.name === config.color)?.hex;
  const topLabel = topStyleOptions.find((o) => o.id === config.topStyle)?.label ?? "";
  const bottomLabel = bottomStyleOptions.find((o) => o.id === config.bottomStyle)?.label ?? "";
  const fabricLabel = fabricOptions.find((f) => f.id === config.fabric)?.label ?? "";

  const previewImage = useMemo(
    () => previewImages[config.topStyle] ?? previewImages["v-neck"],
    [config.topStyle],
  );

  const update = <K extends keyof MixMatchConfig>(key: K, value: MixMatchConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="relative overflow-hidden bg-[linear-gradient(180deg,#f3ecff_0%,#faf8ff_45%,#ffffff_100%)] py-20 md:py-24">
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-ring animate-breathe absolute -left-20 top-20 h-72 w-72 rounded-full opacity-60" />
        <div className="hero-ring animate-breathe absolute -right-16 bottom-10 h-80 w-80 rounded-full opacity-50 [animation-delay:1.5s]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 lg:px-8">
        <div className="grid gap-10 2xl:grid-cols-[minmax(0,0.82fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.72fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.05fr)] xl:items-start xl:gap-8">
          {/* Left — mockup copy block */}
          <div className="space-y-6 xl:sticky xl:top-28">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-brand">
                Mix & Match 3D Visualizer
              </p>
              <h2 className="mt-3 font-display text-3xl font-extrabold leading-tight text-ink md:text-4xl">
                Mix, Match & Make It Yours
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted">
                See it. Style it. Own it. Build your scrub set with live AR preview, fabric tech, and
                personalization — no guesswork.
              </p>
            </div>

            <ul className="space-y-3">
              {checklist.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm font-medium text-ink">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sm shadow-brand/30">
                    <Check size={14} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-3">
              <Link href="/mix-and-match/studio">
                <Button size="lg" className="min-w-[200px]">
                  Start Mix & Match
                  <ArrowRight size={18} />
                </Button>
              </Link>
              <Link href="/mix-and-match">
                <Button variant="outline" size="lg">
                  Learn More
                </Button>
              </Link>
            </div>
          </div>

          {/* Center — 3D stage */}
          <MixMatchVisualizer
            imageSrc={previewImage}
            imageAlt="Mix and match scrub preview"
            topLabel={topLabel}
            bottomLabel={bottomLabel}
            colorLabel={config.color}
            fabricLabel={fabricLabel}
            embroideryName={config.embroideryName || undefined}
            tintHex={tintHex}
          />

          {/* Right — tabbed controls (no AI Fit) */}
          <MixMatchControls
            topStyle={config.topStyle}
            bottomStyle={config.bottomStyle}
            fabric={config.fabric}
            color={config.color}
            embroideryName={config.embroideryName}
            layout="studio"
            onTopChange={(id) => update("topStyle", id)}
            onBottomChange={(id) => update("bottomStyle", id)}
            onFabricChange={(id) => update("fabric", id)}
            onColorChange={(name) => update("color", name)}
            onEmbroideryChange={(name) => update("embroideryName", name)}
          />

          <div className="hidden 2xl:block">
            <AiFitScanPanel
              gender={gender}
              onGenderChange={setGender}
              scanning={scanning}
              onScan={() => {
                setScanning(true);
                window.setTimeout(() => setScanning(false), 1200);
              }}
            />
            <Link
              href="/mix-and-match/studio"
              className="mt-4 block text-center text-sm font-semibold text-brand hover:underline"
            >
              Open full try-on studio →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
