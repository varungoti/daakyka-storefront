"use client";

import { marketingMedia } from "@/data/media/catalog";
import { placeholderForAspect } from "@/data/media/image-manifest";
import type { HeroSlideContent } from "@/lib/homepage";
import { buttonClassNames } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const avatars = marketingMedia.heroAvatars;
const HERO_PLACEHOLDER = placeholderForAspect("wide");

/**
 * No `useReducedMotion` import from framer-motion on purpose — this file
 * must not grow the storefront's framer-motion chunk (already the single
 * biggest remaining "unused JavaScript" offender on `/`, see
 * docs/PERFORMANCE.md's LCP/JS-weight section), and the carousel's own
 * animation is plain CSS (`transition-opacity`), not a framer-motion
 * animation, so its hook doesn't fit here anyway. This is a few lines of
 * vanilla `matchMedia`, mirroring the same query the CSS in globals.css
 * already keys off (`@media (prefers-reduced-motion: reduce)`).
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Reads the real, possibly-already-true value once on mount, then
    // subscribes for changes — matching the same established
    // read-on-mount-then-subscribe pattern as
    // src/components/admin/media-library-browser.tsx's own load(0) call.
    // This can't be computed synchronously during render instead: a
    // "use client" component's first render still happens on the server
    // (no `window`), so the safe, SSR-consistent initial value is `false`
    // on both the server and the client's first hydration pass, corrected
    // here immediately after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

interface HeroCarouselProps {
  slides: HeroSlideContent[];
  /** Admin-configurable auto-advance interval, in milliseconds (see
   * heroSlidesContentSchema — 2,000 to 60,000). */
  autoAdvanceMs: number;
  trustStats: { value: string; label: string }[];
  /** Global (not per-slide) social-proof row, sourced from the legacy
   * "hero" section — see legacyHeroToSlide's doc comment in
   * src/lib/homepage/index.ts for why rating/ratingLabel stayed out of the
   * per-slide field set. */
  rating: string;
  ratingLabel: string;
}

/**
 * Animated hero carousel — the storefront's LCP element on `/`. Replaces
 * the old single-slide `HeroSection` (src/components/home/hero-section.tsx,
 * now trimmed to just `HeroFeatureStrip`).
 *
 * Every slide's full markup (headline, description, CTAs) renders in the
 * initial server-rendered HTML — this is still a "use client" component,
 * but that only means it *also* hydrates in the browser, not that its
 * first-render HTML is any different from a Server Component's. Only slide
 * 0's images are eagerly mounted; a later slide's `<Image>`s aren't
 * rendered into the DOM at all until the carousel actually reaches that
 * slide for the first time (see `visited` below) — a stronger guarantee
 * than relying on `loading="lazy"`, which wouldn't reliably defer an
 * off-screen-opacity (but on-screen-position) stacked slide's image at all.
 *
 * Zero CLS across slides of differing copy length: every slide's text panel
 * is stacked in one CSS grid cell (`grid` + `col-start-1 row-start-1` on
 * each slide, not `absolute inset-0`), so the box's height is the tallest
 * slide's real rendered height, not a guessed fixed min-height — the
 * previous fixed-height approach (F-001) let a slide's CTAs wrap onto a
 * second row and spill under the carousel controls at common desktop
 * widths. Every slide's text is rendered unconditionally (unlike the image
 * collage below) so the grid is sized correctly from first paint — gating
 * it behind `visited` would let the box grow the first time auto-advance
 * reaches a taller slide, which is exactly the layout shift this avoids.
 * The image collage reuses the hero's existing fixed `aspect-[4/5]` frame,
 * which stays CLS-immune per-slide for the same `line-clamp` reason as
 * before.
 */
export function HeroCarousel({ slides, autoAdvanceMs, trustStats, rating, ratingLabel }: HeroCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [visited, setVisited] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  const multiSlide = slides.length > 1;
  // Auto-advance is off whenever the visitor is engaging with the
  // carousel (hover or keyboard focus — WCAG 2.2.2), whenever they've
  // explicitly paused it, whenever the OS asked for reduced motion, or
  // trivially when there's only one slide to advance between.
  const isPaused = manuallyPaused || hovered || focused || reducedMotion || !multiSlide;

  const goTo = useCallback(
    (index: number) => {
      if (slides.length === 0) return;
      const next = ((index % slides.length) + slides.length) % slides.length;
      setActiveIndex(next);
      setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    },
    [slides.length],
  );

  useEffect(() => {
    if (isPaused || slides.length === 0) return;
    const id = window.setInterval(() => {
      // Functional update: never moves focus, never reads/depends on
      // `activeIndex` from the closure, so this effect only needs to
      // restart when the pausing condition or the interval itself changes.
      setActiveIndex((current) => {
        const next = (current + 1) % slides.length;
        setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
        return next;
      });
    }, autoAdvanceMs);
    return () => window.clearInterval(id);
  }, [isPaused, autoAdvanceMs, slides.length]);

  if (slides.length === 0) return null;

  const active = slides[activeIndex];
  const isPlaying = !manuallyPaused;

  return (
    <section
      className="relative overflow-hidden bg-background"
      aria-label="Featured collections"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="hero-ring animate-breathe absolute left-[8%] top-[12%] h-[340px] w-[340px] rounded-full" />
        <div className="hero-ring animate-breathe absolute right-[12%] top-[18%] h-[420px] w-[420px] rounded-full [animation-delay:2s]" />
        <div className="medical-cross-field absolute inset-0 opacity-[0.35]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(138,52,125,0.1),transparent_32%),radial-gradient(circle_at_85%_10%,rgba(93,0,163,0.08),transparent_28%)]" />
      </div>

      {/* F-001: only shown from 2xl (1536px) up. Below that, the content
          column's left edge (max-w-[1320px] + lg:px-8) sits at x<=32-47px
          in the common 1280-1350px range, which is exactly where this hint
          used to be drawn (left-4/xl:left-8), overlapping the headline. At
          1536px+ the column's left edge is well clear (x>=140px). */}
      <div className="pointer-events-none absolute left-8 top-1/2 hidden -translate-y-1/2 2xl:block">
        <p className="rotate-180 text-[10px] font-bold uppercase tracking-[0.35em] text-muted [writing-mode:vertical-rl]">
          Scroll to Explore
        </p>
        <div className="mx-auto mt-4 h-16 w-px bg-gradient-to-b from-brand/60 to-transparent" />
      </div>

      {/* Visually hidden slide-change announcer. Per the W3C APG
          auto-rotating-carousel pattern: "off" while auto-rotating (so an
          unattended slideshow doesn't spam an announcement every few
          seconds), "polite" once rotation has stopped for any reason
          (hover, focus, or the explicit pause button below). */}
      <p aria-live={isPaused ? "polite" : "off"} aria-atomic="true" className="sr-only">
        {`Slide ${activeIndex + 1} of ${slides.length}: ${active.headline}`}
      </p>

      {/* F-085: `gap-6 py-8` on mobile (was `gap-10 py-12`) — the fixed
          mobile min-height this used to have is gone (see F-001's grid-
          stack comment above), but the grid's own gap and padding were
          still sized for desktop and added their own dead space on top of
          three unshrunk sections stacked in a single mobile column. */}
      <div className="relative mx-auto grid max-w-[1320px] items-center gap-6 px-4 py-8 sm:gap-8 md:gap-10 md:py-16 lg:grid-cols-[1.05fr_0.95fr_0.55fr] lg:gap-8 lg:px-8">
        <div className="animate-fade-up lg:pr-4">
          {/* F-001: `grid` instead of `relative` + a guessed min-height.
              Every slide below is stacked in the same grid cell
              (`col-start-1 row-start-1`), so this box's height is always
              the tallest slide's real content height — it can never be
              shorter than what's actually rendered, which is what let the
              carousel controls end up on top of a wrapped CTA row before. */}
          <div className="grid">
            {slides.map((slide, index) => (
              <div
                key={slide.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${slides.length}`}
                aria-hidden={index !== activeIndex}
                inert={index !== activeIndex}
                className={cn(
                  "col-start-1 row-start-1 self-start space-y-7 transition-opacity duration-700 ease-out",
                  index === activeIndex ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                {/* Unlike the image collage below, text is rendered for
                    every slide unconditionally (not gated on `visited`) so
                    the grid above is sized correctly from first paint —
                    see the component doc comment for why gating this would
                    reintroduce the layout shift F-001 fixed. It's a small
                    amount of extra text DOM, not the image weight that
                    `visited` exists to defer. Only slide 0 renders an
                    `<h1>`; the rest render the same styling as `<h2>` so
                    the page keeps exactly one `<h1>`. */}
                <span className="inline-flex max-w-full truncate rounded-full bg-brand px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-white">
                  {slide.eyebrow}
                </span>

                <div className="space-y-4">
                  {index === 0 ? (
                    <h1 className="line-clamp-3 font-display text-[2.75rem] font-bold leading-[1.02] tracking-tight text-ink md:text-5xl xl:text-[3.75rem]">
                      {slide.headline}
                    </h1>
                  ) : (
                    <h2 className="line-clamp-3 font-display text-[2.75rem] font-bold leading-[1.02] tracking-tight text-ink md:text-5xl xl:text-[3.75rem]">
                      {slide.headline}
                    </h2>
                  )}
                  <p className="line-clamp-2 font-display text-xl font-medium text-ink/85 md:text-2xl">
                    {slide.subheadline}
                  </p>
                  <p className="line-clamp-3 max-w-lg text-base leading-relaxed text-muted">
                    {slide.description}
                  </p>
                </div>

                <div className="flex flex-wrap gap-4">
                  <Link href={slide.primaryCta.href} className={buttonClassNames({ size: "lg", className: "min-w-[170px]" })}>
                    {slide.primaryCta.label}
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                  <Link
                    href={slide.secondaryCta.href}
                    className={buttonClassNames({ variant: "outline", size: "lg", className: "min-w-[170px]" })}
                  >
                    {slide.secondaryCta.label}
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {multiSlide && (
            <div className="relative z-10 mt-2 flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goTo(activeIndex - 1)}
                  aria-label="Previous slide"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-ink transition hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                >
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => goTo(activeIndex + 1)}
                  aria-label="Next slide"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-ink transition hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                >
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>

              <div className="flex items-center gap-1">
                {slides.map((slide, index) => (
                  // F-240: axe's target-size audit flagged these at 10x10 —
                  // the button itself is now a 24px hit area (`h-6 min-w-6`)
                  // around the same visually 10px-tall pill (`span` below).
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => goTo(index)}
                    aria-label={`Go to slide ${index + 1} of ${slides.length}: ${slide.headline}`}
                    aria-current={index === activeIndex ? "true" : undefined}
                    className="group grid h-6 min-w-6 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "block h-2.5 rounded-full transition-all",
                        index === activeIndex ? "w-6 bg-brand" : "w-2.5 bg-ink/20 group-hover:bg-ink/40",
                      )}
                    />
                  </button>
                ))}
              </div>

              {!reducedMotion && (
                <button
                  type="button"
                  onClick={() => setManuallyPaused((prev) => !prev)}
                  aria-label={isPlaying ? "Pause slideshow" : "Play slideshow"}
                  aria-pressed={!isPlaying}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-ink transition hover:border-brand hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                >
                  {isPlaying ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                </button>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center gap-4">
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
              {rating && (
                <div className="flex items-center gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={14} className="fill-amber-400 text-amber-400" />
                  ))}
                  <span className="ml-1 text-sm font-bold text-ink">{rating}</span>
                </div>
              )}
              <p className="text-xs text-muted">{ratingLabel}</p>
            </div>
          </div>
        </div>

        {/* F-085: `order-first` puts the model photos ahead of the text
            column in the single-column mobile layout (`lg:order-none`
            restores document order at the 3-column desktop layout) — this
            used to be the very last thing on the page before the trust-
            stat cards, so a phone shopper's whole first screen was text
            with no product imagery at all. */}
        <div className="animate-scale-in relative order-first mx-auto w-full max-w-md lg:order-none lg:max-w-none">
          <div className="absolute inset-x-6 top-6 bottom-6 rounded-full bg-brand/10 blur-3xl" />
          <div className="relative mx-auto aspect-[4/5] max-w-lg">
            <div className="absolute bottom-[8%] left-1/2 h-8 w-[72%] -translate-x-1/2 rounded-[100%] bg-brand/25 blur-2xl" />
            <div className="absolute bottom-[6%] left-1/2 h-3 w-[68%] -translate-x-1/2 rounded-full border border-brand/20 bg-[linear-gradient(180deg,rgba(138,52,125,0.35),rgba(138,52,125,0.05))] shadow-[0_0_40px_rgba(138,52,125,0.35)]" />

            {slides.map((slide, index) => {
              const isActive = index === activeIndex;
              const isVisited = visited.has(index);
              const mainImage = slide.image ?? { url: HERO_PLACEHOLDER, alt: "" };
              const secondaryImage = slide.secondaryImage ?? { url: HERO_PLACEHOLDER, alt: "" };
              return (
                <div
                  key={slide.id}
                  aria-hidden={!isActive}
                  inert={!isActive}
                  className={cn(
                    "absolute inset-0 transition-opacity duration-700 ease-out",
                    isActive ? "opacity-100" : "pointer-events-none opacity-0",
                  )}
                >
                  {isVisited && (
                    <div className="relative flex h-full items-end justify-center gap-1 px-4 pb-[10%] md:gap-3">
                      <div className="relative h-[88%] w-[46%] overflow-hidden rounded-[1.5rem] hero-model-frame shadow-[0_20px_50px_rgba(138,52,125,0.15)]">
                        <Image
                          src={secondaryImage.url}
                          alt={secondaryImage.alt || ""}
                          fill
                          className="object-cover object-top"
                          sizes="(max-width: 1024px) 42vw, 18vw"
                        />
                      </div>
                      <div className="relative h-[94%] w-[48%] overflow-hidden rounded-[1.5rem] hero-model-frame shadow-[0_24px_60px_rgba(138,52,125,0.2)]">
                        <Image
                          src={mainImage.url}
                          alt={mainImage.alt || (index === 0 ? "Healthcare team in DAAKYKA scrubs" : "")}
                          fill
                          preload={index === 0}
                          fetchPriority={index === 0 ? "high" : undefined}
                          quality={75}
                          className="object-cover object-top"
                          sizes="(max-width: 1024px) 44vw, 20vw"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="animate-fade-up-delay-2 hidden space-y-4 lg:block">
          {trustStats.map((stat) => (
            <div
              key={stat.label}
              className="glass-card hover:border-brand hover:shadow-sm transition-colors rounded-2xl border border-border px-5 py-4 shadow-sm"
            >
              <p className="font-display text-xl font-bold text-brand">{stat.value}</p>
              <p className="mt-1 text-sm text-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="relative mx-auto mt-8 grid max-w-[1320px] grid-cols-3 gap-3 px-4 lg:hidden lg:px-8">
        {trustStats.map((stat) => (
          <div
            key={stat.label}
            className="glass-card hover:border-brand hover:shadow-sm transition-colors rounded-xl border border-border px-3 py-3 text-center shadow-sm"
          >
            <p className="font-display text-sm font-bold text-brand">{stat.value}</p>
            <p className="mt-0.5 text-[10px] leading-tight text-muted">{stat.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
