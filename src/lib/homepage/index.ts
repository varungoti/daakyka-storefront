import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { getSiteImage } from "@/lib/media/get-site-image";

export interface HeroContent {
  eyebrow: string;
  headline: string;
  subheadline: string;
  description: string;
  primaryCta: string;
  secondaryCta: string;
  rating: string;
  ratingLabel: string;
}

export interface AnnouncementContent {
  messages: string[];
}

export interface TrustStatsContent {
  stats: { value: string; label: string }[];
}

// ---------------------------------------------------------------------------
// Hero carousel slides (release-hardening — configurable hero carousel).
// Stored under the "hero-slides" HomepageSection key, alongside (not
// replacing) the legacy single "hero" key above: see getHeroSlidesContent()
// below for how the two relate.
// ---------------------------------------------------------------------------

export interface HeroSlideCta {
  label: string;
  href: string;
}

/** A slide's picked media, snapshotted at save time from the
 * MediaLibraryBrowser selection (id/url/alt) — see heroSlideImageSchema's
 * doc comment in src/lib/validation/schemas.ts for why this is a snapshot
 * rather than a live MediaAsset relation. */
export interface HeroSlideImage {
  assetId: string;
  url: string;
  alt: string;
}

export interface HeroSlideContent {
  /** Stable client-generated id (not a DB row id) — see
   * heroSlideSchema's doc comment. */
  id: string;
  enabled: boolean;
  eyebrow: string;
  headline: string;
  subheadline: string;
  description: string;
  primaryCta: HeroSlideCta;
  secondaryCta: HeroSlideCta;
  image: HeroSlideImage | null;
  secondaryImage: HeroSlideImage | null;
}

export interface HeroSlidesContent {
  slides: HeroSlideContent[];
  /** Auto-advance interval in milliseconds (2,000–60,000; see
   * heroSlidesContentSchema). */
  autoAdvanceMs: number;
}

const defaultHero: HeroContent = {
  eyebrow: "Welcome to DAAKYKA",
  headline: "Expertly Designed, Meticulously Crafted",
  subheadline: "Quality Uniforms & Linens for Pan India",
  description:
    "Hospital linens, medical scrubs, school uniforms, and corporate wear by Babaji Enterprises — Hyderabad-based, Pan India delivery.",
  primaryCta: "Shop All Scrubs",
  secondaryCta: "Build Your Fit",
  // Phase C3: no fabricated star rating or follower count — these were
  // unverifiable claims flagged for removal. ratingLabel now carries a
  // real, verifiable fact instead of a rating; HeroSection only renders
  // the star row when `rating` is non-empty.
  rating: "",
  ratingLabel: "Hyderabad-Based · 9+ Years of Trusted Manufacturing",
};

const defaultAnnouncement: AnnouncementContent = {
  messages: [
    "Free Shipping on Orders Over ₹8,000",
    "30-Day Easy Returns",
    "Designed for Heroes",
  ],
};

const defaultTrustStats: TrustStatsContent = {
  stats: [
    { value: "9+", label: "Years Manufacturing" },
    { value: "Pan India", label: "Delivery & Fulfillment" },
    { value: "100%", label: "Secure Checkout" },
  ],
};

// No slides until an admin adds one — see getHeroSlidesContent() below for
// why an empty list still renders a correct (non-blank) hero.
const defaultHeroSlides: HeroSlidesContent = { slides: [], autoAdvanceMs: 6000 };

/**
 * Cache tag for every `HomepageSection` read below. src/app/page.tsx (the
 * "/" route) is fully static (`○ /` in the build output), so its calls to
 * getHeroContent()/getTrustStatsContent() only ever run at `next build`
 * time (or during an ISR regeneration) — the read below being uncached
 * doesn't matter, because the *page* still bakes whatever it returned into
 * the prerendered HTML either way. Only revalidateTag/revalidatePath can
 * invalidate that. We use revalidateTag (see updateHomepageSection below)
 * rather than revalidatePath: per
 * node_modules/next/dist/docs/01-app/02-guides/incremental-static-regeneration.md
 * ("On-demand revalidation with revalidateTag"), the documented pattern for
 * this exact shape — a Page reading through unstable_cache(..., { tags })
 * — is revalidateTag alone, no paired revalidatePath. revalidateTag.md's
 * own "Good to know" confirms it: calling revalidateTag marks the tag
 * stale, and "pages using the tag revalidate as they are visited" — i.e.
 * a tagged unstable_cache read pulls its consuming page's prerendered
 * output into the same on-demand-ISR invalidation, exactly like
 * src/lib/settings/index.ts's SETTINGS_CACHE_TAG already relies on.
 */
export const HOMEPAGE_CACHE_TAG = "homepage";

async function readSectionContentFromDb<T>(key: string, fallback: T): Promise<T> {
  try {
    const section = await db.homepageSection.findUnique({ where: { key } });
    if (!section?.enabled) return fallback;
    return JSON.parse(section.content) as T;
  } catch {
    return fallback;
  }
}

// One shared tag for all three sections (mirrors src/lib/settings/index.ts:
// every key is cached separately below but revalidated together, since
// updateHomepageSection() takes an arbitrary key and doesn't know which
// single cached getter to target).
const cachedGetHero = unstable_cache(
  () => readSectionContentFromDb("hero", defaultHero),
  ["homepage-hero"],
  { tags: [HOMEPAGE_CACHE_TAG] },
);
const cachedGetAnnouncement = unstable_cache(
  () => readSectionContentFromDb("announcement", defaultAnnouncement),
  ["homepage-announcement"],
  { tags: [HOMEPAGE_CACHE_TAG] },
);
const cachedGetTrustStats = unstable_cache(
  () => readSectionContentFromDb("trust-stats", defaultTrustStats),
  ["homepage-trust-stats"],
  { tags: [HOMEPAGE_CACHE_TAG] },
);
const cachedGetHeroSlides = unstable_cache(
  () => readSectionContentFromDb("hero-slides", defaultHeroSlides),
  ["homepage-hero-slides"],
  { tags: [HOMEPAGE_CACHE_TAG] },
);

export async function getHeroContent(): Promise<HeroContent> {
  try {
    return await cachedGetHero();
  } catch {
    // unstable_cache needs Next's incremental cache / request store, which
    // isn't present outside an actual Next server (unit tests, scripts,
    // etc). Fall back to an uncached read rather than throwing.
    return readSectionContentFromDb("hero", defaultHero);
  }
}

export async function getAnnouncementContent(): Promise<AnnouncementContent> {
  try {
    return await cachedGetAnnouncement();
  } catch {
    return readSectionContentFromDb("announcement", defaultAnnouncement);
  }
}

export async function getTrustStatsContent(): Promise<TrustStatsContent> {
  try {
    return await cachedGetTrustStats();
  } catch {
    return readSectionContentFromDb("trust-stats", defaultTrustStats);
  }
}

async function readHeroSlidesRaw(): Promise<HeroSlidesContent> {
  try {
    return await cachedGetHeroSlides();
  } catch {
    return readSectionContentFromDb("hero-slides", defaultHeroSlides);
  }
}

/**
 * Pure mapping from the legacy single-hero shape to one carousel slide —
 * split out from getHeroSlidesContent() below so it's unit-testable
 * without a database (see src/lib/homepage/index.test.ts). The two CTA
 * targets are hardcoded to match exactly what src/components/home/
 * hero-section.tsx rendered before this feature existed (it always called
 * page.tsx with `mixMatchEnabled` unset, i.e. `false`, so the secondary
 * CTA always linked to "/for-hospitals" in production) — not derived from
 * the live mixMatchEnabled flag, since a slide's CTA links are now
 * explicit, admin-authored data rather than something a feature flag
 * should keep silently swapping underneath an existing store.
 */
export function legacyHeroToSlide(
  hero: HeroContent,
  mainImage: { url: string; alt: string } | null,
  secondaryImage: { url: string; alt: string } | null,
): HeroSlideContent {
  return {
    id: "legacy-hero",
    enabled: true,
    eyebrow: hero.eyebrow,
    headline: hero.headline,
    subheadline: hero.subheadline,
    description: hero.description,
    primaryCta: { label: hero.primaryCta, href: "/shop" },
    secondaryCta: { label: hero.secondaryCta, href: "/for-hospitals" },
    image: mainImage ? { assetId: "home.hero.1", url: mainImage.url, alt: mainImage.alt } : null,
    secondaryImage: secondaryImage
      ? { assetId: "home.hero.2", url: secondaryImage.url, alt: secondaryImage.alt }
      : null,
  };
}

/**
 * The storefront's read path for the animated hero carousel
 * (src/components/home/hero-carousel.tsx, via src/app/page.tsx). Cached
 * and tagged exactly like getHeroContent() above (same HOMEPAGE_CACHE_TAG,
 * invalidated by the same updateHomepageSection() write path — see that
 * function's own doc comment for the revalidateTag citation).
 *
 * Disabled slides are filtered out here (once, server-side) rather than by
 * every caller. When that leaves zero slides — either because no admin has
 * ever configured any (a store that's never opened the new admin UI), or
 * because every configured slide is currently disabled — this falls back
 * to a single slide built from the legacy "hero" section plus the existing
 * home.hero.1/home.hero.2 site images, so the homepage never renders a
 * blank hero. That fallback composition is intentionally NOT wrapped in
 * its own unstable_cache layer: getHeroContent() and getSiteImage() are
 * already independently cached and tagged (HOMEPAGE_CACHE_TAG and
 * MEDIA_CACHE_TAG respectively), so calling them directly here still hits
 * Next's Data Cache correctly without a second caching layer to keep in
 * sync.
 */
export async function getHeroSlidesContent(): Promise<HeroSlidesContent> {
  const raw = await readHeroSlidesRaw();
  const enabledSlides = raw.slides.filter((slide) => slide.enabled);
  if (enabledSlides.length > 0) {
    return { slides: enabledSlides, autoAdvanceMs: raw.autoAdvanceMs };
  }

  const [legacy, mainImage, secondaryImage] = await Promise.all([
    getHeroContent(),
    getSiteImage("home.hero.1"),
    getSiteImage("home.hero.2"),
  ]);

  return {
    slides: [legacyHeroToSlide(legacy, mainImage, secondaryImage)],
    autoAdvanceMs: raw.autoAdvanceMs,
  };
}

/**
 * Uncached, unfiltered read for the admin editor
 * (src/app/admin/(panel)/homepage/page.tsx) — deliberately returns exactly
 * what's stored (including disabled slides, so an admin can re-enable one)
 * rather than the storefront's filtered-plus-legacy-fallback view. Mirrors
 * src/lib/testimonials/index.ts's getAllTestimonialsForAdmin(): "the admin
 * UI should always show live data."
 */
export async function getHeroSlidesContentForAdmin(): Promise<HeroSlidesContent> {
  return readSectionContentFromDb("hero-slides", defaultHeroSlides);
}

/**
 * Invalidates every cached homepage section at once. Split out from
 * updateHomepageSection() below (rather than inlining the revalidateTag
 * call) so it's independently testable: next/cache's exports are
 * non-configurable accessor properties and this project's tests run as
 * real ESM (import bindings can't be reassigned either), so nothing in
 * `next/cache` can be spied on from a test — see
 * src/lib/homepage/index.test.ts, which injects a fake `revalidate` here
 * instead. Production callers always use the default (the real
 * revalidateTag).
 */
export function revalidateHomepageCache(
  revalidate: (tag: string, profile: string) => void = revalidateTag,
): void {
  try {
    revalidate(HOMEPAGE_CACHE_TAG, "max");
  } catch {
    // No static generation store in this context (unit tests, scripts) —
    // nothing to revalidate. Same defensive pattern as
    // src/lib/settings/index.ts's setSetting().
  }
}

export async function getAllHomepageSections() {
  return db.homepageSection.findMany({
    orderBy: { sortOrder: "asc" },
  });
}

export async function updateHomepageSection(
  key: string,
  content: unknown,
  userId: string,
) {
  const section = await db.homepageSection.update({
    where: { key },
    data: { content: JSON.stringify(content) },
  });

  const { logAuditEvent } = await import("@/lib/auth/audit");
  await logAuditEvent({
    userId,
    action: "update",
    entity: "homepage_section",
    entityId: key,
  });

  revalidateHomepageCache();

  return section;
}
