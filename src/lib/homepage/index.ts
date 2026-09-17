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

async function getSectionContent<T>(key: string, fallback: T): Promise<T> {
  try {
    const section = await db.homepageSection.findUnique({ where: { key } });
    if (!section?.enabled) return fallback;
    return JSON.parse(section.content) as T;
  } catch {
    return fallback;
  }
}

export async function getHeroContent(): Promise<HeroContent> {
  return getSectionContent("hero", defaultHero);
}

export async function getAnnouncementContent(): Promise<AnnouncementContent> {
  return getSectionContent("announcement", defaultAnnouncement);
}

export async function getTrustStatsContent(): Promise<TrustStatsContent> {
  return getSectionContent("trust-stats", defaultTrustStats);
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

  return section;
}
