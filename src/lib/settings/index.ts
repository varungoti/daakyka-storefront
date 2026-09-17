import { revalidateTag, unstable_cache } from "next/cache";
import { z } from "zod";
import { brand } from "@/data/brand";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Typed site-wide settings, backed by the `SiteSetting` table.
 *
 * Every key has a compile-time value type (`SettingValueMap`), a runtime
 * zod schema (`settingSchemas`) used to validate both what comes out of the
 * database and what admins submit through the API, and a hard-coded
 * default used whenever no row exists yet, the DB is unreachable, or the
 * stored value fails validation.
 */
export interface SettingValueMap {
  "pages.fabricTech.enabled": boolean;
  "pages.mixMatch.enabled": boolean;
  "sale.enabled": boolean;
  "header.bulkCta.enabled": boolean;
  "announcement.messages": string[];
  "shipping.flatRate": number;
  "shipping.freeAbove": number;
  "contact.phone": string;
  "contact.whatsapp": string;
  "contact.email": string;
  "contact.address": string;
}

export type SettingKey = keyof SettingValueMap;

export const SETTINGS_CACHE_TAG = "settings";

export const settingDefaults: SettingValueMap = {
  "pages.fabricTech.enabled": false,
  "pages.mixMatch.enabled": false,
  "sale.enabled": true,
  "header.bulkCta.enabled": true,
  "announcement.messages": [...brand.announcementMessages],
  "shipping.flatRate": 99,
  "shipping.freeAbove": 8000,
  "contact.phone": "+91 95530 94251",
  "contact.whatsapp": "+91 95530 94251",
  "contact.email": "daakykaapparels@gmail.com",
  "contact.address": "286 Ridgewood Residency, Road No. 6, Kavuri Hills, Hyderabad, Telangana",
};

export const settingSchemas: { [K in SettingKey]: z.ZodType<SettingValueMap[K]> } = {
  "pages.fabricTech.enabled": z.boolean(),
  "pages.mixMatch.enabled": z.boolean(),
  "sale.enabled": z.boolean(),
  "header.bulkCta.enabled": z.boolean(),
  "announcement.messages": z.array(z.string().trim().min(1).max(200)).min(1).max(10),
  "shipping.flatRate": z.number().min(0).max(100_000),
  "shipping.freeAbove": z.number().min(0).max(10_000_000),
  "contact.phone": z.string().trim().min(6).max(30),
  "contact.whatsapp": z.string().trim().min(6).max(30),
  "contact.email": z.string().trim().email().max(200),
  "contact.address": z.string().trim().min(5).max(500),
};

const settingKeys = Object.keys(settingDefaults) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return (settingKeys as string[]).includes(key);
}

async function readSettingFromDb<K extends SettingKey>(key: K): Promise<SettingValueMap[K]> {
  const fallback = settingDefaults[key];
  try {
    const row = await db.siteSetting.findUnique({ where: { key } });
    if (!row) return fallback;
    const parsed = settingSchemas[key].safeParse(row.value);
    if (!parsed.success) return fallback;
    return parsed.data;
  } catch {
    // DB unavailable (e.g. at build time, or a local script without a
    // running Postgres) — fall back to the default so callers never crash.
    return fallback;
  }
}

// Cached per-key with Next's data cache, tagged "settings" so setSetting()
// can invalidate every cached key at once via revalidateTag.
const cachedReadSetting = unstable_cache(
  async (key: SettingKey) => readSettingFromDb(key),
  ["site-setting"],
  { tags: [SETTINGS_CACHE_TAG] },
);

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValueMap[K]> {
  try {
    return (await cachedReadSetting(key)) as SettingValueMap[K];
  } catch {
    // unstable_cache needs Next's incremental cache / request store, which
    // isn't present outside an actual Next server (unit tests, scripts,
    // etc). Fall back to an uncached read rather than throwing.
    return readSettingFromDb(key);
  }
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValueMap[K],
  userId: string,
): Promise<SettingValueMap[K]> {
  const parsed = settingSchemas[key].parse(value);

  await db.siteSetting.upsert({
    where: { key },
    create: { key, value: parsed as Prisma.InputJsonValue, updatedById: userId },
    update: { value: parsed as Prisma.InputJsonValue, updatedById: userId },
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "site_setting",
    entityId: key,
    metadata: { value: parsed },
  });

  try {
    revalidateTag(SETTINGS_CACHE_TAG, "max");
  } catch {
    // No static generation store in this context (unit tests, scripts) —
    // nothing to revalidate.
  }

  return parsed;
}

export async function isPageEnabled(page: "fabricTech" | "mixMatch"): Promise<boolean> {
  const key: SettingKey = page === "fabricTech" ? "pages.fabricTech.enabled" : "pages.mixMatch.enabled";
  return getSetting(key);
}

export async function isSaleEnabled(): Promise<boolean> {
  return getSetting("sale.enabled");
}
