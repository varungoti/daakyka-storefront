"use client";

import { Droplets, Leaf, Shield, Sparkles } from "lucide-react";

/**
 * The single-hero `HeroSection` component that used to live in this file
 * was superseded by the animated hero carousel
 * (src/components/home/hero-carousel.tsx, wired up in src/app/page.tsx) —
 * release-hardening "configurable hero carousel". `HeroFeatureStrip` below
 * is a separate, unrelated section (also used by src/app/our-story/page.tsx)
 * and stays exactly as it was.
 */

export function HeroFeatureStrip() {
  const features = [
    { icon: Sparkles, label: "4-Way Stretch", sub: "Maximum comfort" },
    { icon: Droplets, label: "Liquid Repellent", sub: "Stay clean, stay dry" },
    { icon: Shield, label: "Anti-Microbial", sub: "Protection all day" },
    { icon: Leaf, label: "Eco-Friendly Fabric", sub: "Sustainable & responsible" },
  ];

  return (
    <section className="border-y border-border bg-surface-muted py-6 backdrop-blur-sm">
      <div className="mx-auto grid max-w-[1320px] grid-cols-2 gap-4 px-4 md:grid-cols-4 lg:px-8">
        {features.map(({ icon: Icon, label, sub }) => (
          <div key={label} className="flex items-center gap-4 rounded-2xl px-3 py-2">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-lilac/70 text-brand">
              <Icon size={22} />
            </div>
            <div>
              <p className="text-sm font-bold text-ink">{label}</p>
              <p className="text-xs text-muted">{sub}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
