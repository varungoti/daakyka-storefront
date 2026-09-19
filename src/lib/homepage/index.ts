import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/lib/db";

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
