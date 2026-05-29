"use client";

import { marketingMedia } from "@/data/media/catalog";
import type { HeroContent } from "@/lib/homepage";
import { Button } from "@/components/ui/button";
import { ArrowRight, Droplets, Leaf, Shield, Sparkles, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

const avatars = marketingMedia.heroAvatars;

interface HeroSectionProps {
  content: HeroContent;
  trustStats: { value: string; label: string }[];
}

export function HeroSection({ content, trustStats }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden bg-[linear-gradient(180deg,#f7f2ff_0%,#fcfbff_55%,#ffffff_100%)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-ring animate-breathe absolute left-[8%] top-[12%] h-[340px] w-[340px] rounded-full" />
        <div className="hero-ring animate-breathe absolute right-[12%] top-[18%] h-[420px] w-[420px] rounded-full [animation-delay:2s]" />
        <div className="medical-cross-field absolute inset-0 opacity-[0.35]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(91,46,255,0.1),transparent_32%),radial-gradient(circle_at_85%_10%,rgba(124,58,237,0.08),transparent_28%)]" />
      </div>

      <div className="pointer-events-none absolute left-4 top-1/2 hidden -translate-y-1/2 lg:block xl:left-8">
        <p className="rotate-180 text-[10px] font-bold uppercase tracking-[0.35em] text-muted [writing-mode:vertical-rl]">
          Scroll to Explore
        </p>
        <div className="mx-auto mt-4 h-16 w-px bg-gradient-to-b from-brand/60 to-transparent" />
      </div>

      <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 lg:grid-cols-[1.05fr_0.95fr_0.55fr] lg:gap-8 lg:px-8 lg:py-20 xl:py-24">
        <div className="animate-fade-up space-y-7 lg:pr-4">
          <span className="inline-flex rounded-full bg-brand px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-white">
            {content.eyebrow}
          </span>

          <div className="space-y-4">
            <h1 className="font-display text-[2.75rem] font-extrabold leading-[1.02] tracking-tight text-ink md:text-6xl xl:text-[3.75rem]">
              {content.headline.includes("Meticulously Crafted") ? (
                <>
                  Expertly Designed,{" "}
                  <span className="gradient-text">Meticulously Crafted</span>
                </>
              ) : content.headline.includes("Medical Commerce") ? (
                <>
                  The Future of{" "}
                  <span className="gradient-text">Medical Commerce</span>
                </>
              ) : (
                content.headline
              )}
            </h1>
            <p className="font-display text-xl font-medium text-ink/85 md:text-2xl">
              {content.subheadline}
            </p>
            <p className="max-w-lg text-base leading-relaxed text-muted">
              {content.description}
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <Link href="/shop">
              <Button size="lg" className="min-w-[170px]">
                {content.primaryCta}
                <ArrowRight size={18} />
              </Button>
            </Link>
            <Link href="/mix-and-match/studio">
              <Button variant="outline" size="lg" className="min-w-[170px]">
                {content.secondaryCta}
              </Button>
            </Link>
          </div>

          <div className="flex items-center gap-4 pt-2">
            <div className="flex -space-x-3">
              {avatars.map((src, i) => (
                <div
                  key={src}
                  className="relative h-10 w-10 overflow-hidden rounded-full border-2 border-white shadow-sm"
                  style={{ zIndex: avatars.length - i }}
                >
                  <Image src={src} alt="" fill className="object-cover" sizes="40px" />
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} size={14} className="fill-amber-400 text-amber-400" />
                ))}
                <span className="ml-1 text-sm font-bold text-ink">{content.rating}</span>
              </div>
              <p className="text-xs text-muted">{content.ratingLabel}</p>
            </div>
          </div>
        </div>

        <div className="animate-scale-in relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="absolute inset-x-6 top-6 bottom-6 rounded-full bg-brand/10 blur-3xl" />
          <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_24px_80px_rgba(91,46,255,0.18)]">
            <Image
              src={marketingMedia.heroMain}
              alt="Healthcare professionals wearing DAAKYKA scrubs"
              fill
              priority
              fetchPriority="high"
              quality={75}
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 40vw"
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_80%,rgba(91,46,255,0.15),transparent_55%)]" />
          </div>
        </div>

        <div className="animate-fade-up-delay-2 hidden space-y-4 lg:block">
          {trustStats.map((stat) => (
            <div
              key={stat.label}
              className="glass-card rounded-2xl border border-white/80 px-5 py-4 shadow-sm"
            >
              <p className="font-display text-xl font-bold text-brand">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="relative mx-auto mt-8 grid max-w-7xl grid-cols-3 gap-3 px-4 lg:hidden lg:px-8">
        {trustStats.map((stat) => (
          <div
            key={stat.label}
            className="glass-card rounded-xl border border-white/80 px-3 py-3 text-center shadow-sm"
          >
            <p className="font-display text-sm font-bold text-brand">{stat.value}</p>
            <p className="mt-0.5 text-[10px] leading-tight text-muted">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function HeroFeatureStrip() {
  const features = [
    { icon: Sparkles, label: "4-Way Stretch", sub: "Maximum comfort" },
    { icon: Droplets, label: "Liquid Repellent", sub: "Stay clean, stay dry" },
    { icon: Shield, label: "Anti-Microbial", sub: "Protection all day" },
    { icon: Leaf, label: "Eco-Friendly Fabric", sub: "Sustainable & responsible" },
  ];

  return (
    <section className="border-y border-border bg-white/80 py-6 backdrop-blur-sm">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 md:grid-cols-4 lg:px-8">
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
