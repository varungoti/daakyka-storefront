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
  headline: "The Future of Medical Commerce",
  subheadline: "Futuristic. Functional. Flawless.",
  description:
    "Premium scrubs engineered with advanced fabric technology for healthcare professionals who do more.",
  primaryCta: "Shop All Scrubs",
  secondaryCta: "Build Your Fit",
  rating: "4.9/5",
  ratingLabel: "Trusted by 20,000+ healthcare professionals",
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
    { value: "20,000+", label: "Healthcare Professionals" },
    { value: "4.9/5", label: "Customer Rating" },
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
