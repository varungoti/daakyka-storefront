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
  // release-hardening pdp-content-legal-pricing-reviews (F-150, F-195,
  // F-312): admin-editable, blank-by-default facts a lawyer/owner has to
  // supply — never invented by code. Every page that renders one of these
  // hides the corresponding line/section when it's still "" rather than
  // showing a placeholder or a fabricated value.
  "grievance.name": string;
  "grievance.designation": string;
  "grievance.email": string;
  "grievance.phone": string;
  "legal.gstin": string;
  // Telangana's GST state code — defaults to the seller's own registered
  // state (see src/data/brand.ts's location), which is a known fact, not
  // an invented one. Used to tell an intra-state order (CGST+SGST) from an
  // inter-state one (IGST) once real tax data exists.
  "legal.stateCode": string;
  // F-026: the one return/exchange window every surface (PDP, /returns,
  // trust badges, homepage) renders, so they can't contradict each other
  // again. 30 matches what the Returns page, the trust bar and the
  // homepage default already said before this fix.
  "returns.windowDays": number;
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
  "grievance.name": "",
  "grievance.designation": "",
  "grievance.email": "",
  "grievance.phone": "",
  "legal.gstin": "",
  "legal.stateCode": "36",
  "returns.windowDays": 30,
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
  "grievance.name": z.string().trim().max(120),
  "grievance.designation": z.string().trim().max(120),
  "grievance.email": z.union([z.literal(""), z.string().trim().email()]).transform((v) => v),
  "grievance.phone": z.string().trim().max(30),
  "legal.gstin": z.union([
    z.literal(""),
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Not a valid 15-character GSTIN"),
  ]),
  "legal.stateCode": z.string().trim().max(2),
  "returns.windowDays": z.number().int().min(1).max(365),
};

const settingKeys = Object.keys(settingDefaults) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return (settingKeys as string[]).includes(key);
}

// F-222: this is the function unstable_cache wraps below, so it must let a
// DB error (pool exhausted, connection reset, etc.) propagate rather than
// swallow it. unstable_cache only ever stores a *resolved* value — a
// rejection is never cached — so if this function caught the error and
// returned the fallback itself, that fallback would get cached as if it
// were real data, for up to a year, until an admin happened to save a
// setting. Returning the default is still correct for a genuinely missing
// row or a value that fails its schema, since those are deterministic and
// safe to cache. getSetting() below applies the fallback for a failed read
// *outside* the cache boundary instead, so a transient failure only ever
// affects the one call that hit it.
async function fetchSettingFromDb<K extends SettingKey>(key: K): Promise<SettingValueMap[K]> {
  const row = await db.siteSetting.findUnique({ where: { key } });
  if (!row) return settingDefaults[key];
  const parsed = settingSchemas[key].safeParse(row.value);
  if (!parsed.success) return settingDefaults[key];
  return parsed.data;
}

// Cached per-key with Next's data cache, tagged "settings" so setSetting()
// can invalidate every cached key at once via revalidateTag.
const cachedReadSetting = unstable_cache(
  async (key: SettingKey) => fetchSettingFromDb(key),
  ["site-setting"],
  { tags: [SETTINGS_CACHE_TAG] },
);

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValueMap[K]> {
  try {
    return (await cachedReadSetting(key)) as SettingValueMap[K];
  } catch {
    // Two different situations land here, and both are handled the same
    // way: either unstable_cache's incremental cache / request store isn't
    // present (unit tests, scripts, outside an actual Next server), or the
    // DB read itself failed. Retry once, uncached, and fall back to the
    // hard-coded default for *this call only* on any further failure —
    // never cache a failure as if it were real data.
    try {
      return await fetchSettingFromDb(key);
    } catch {
      return settingDefaults[key];
    }
  }
}

/**
 * F-343 fix: this used to `upsert` unconditionally — two admins saving the
 * same setting (e.g. two edits to `announcement.messages`) around the same
 * time both got a 200, and whichever write committed last silently
 * overwrote the other with no signal that anything was lost. Thrown when a
 * caller passes `expectedUpdatedAt` and the stored row's `updatedAt` no
 * longer matches it — someone else saved this key in between this caller
 * loading it and submitting its own edit.
 */
export class StaleSettingError extends Error {
  constructor(key: string) {
    super(`"${key}" was changed by someone else — reload and try again.`);
    this.name = "StaleSettingError";
  }
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValueMap[K],
  userId: string,
  // Optional and last, purely additive: every existing call site keeps
  // writing unconditionally until it's updated to pass the row's
  // previously-loaded updatedAt.
  expectedUpdatedAt?: Date,
): Promise<SettingValueMap[K]> {
  const parsed = settingSchemas[key].parse(value);

  if (expectedUpdatedAt) {
    // A row that doesn't exist yet can't be stale — `updateMany` matches
    // zero rows either way, so an existence check comes first to tell
    // "never saved" apart from "saved by someone else since you loaded it".
    const current = await db.siteSetting.findUnique({ where: { key }, select: { updatedAt: true } });
    if (current) {
      const { count } = await db.siteSetting.updateMany({
        where: { key, updatedAt: expectedUpdatedAt },
        data: { value: parsed as Prisma.InputJsonValue, updatedById: userId },
      });
      if (count === 0) throw new StaleSettingError(key);
    } else {
      await db.siteSetting.create({ data: { key, value: parsed as Prisma.InputJsonValue, updatedById: userId } });
    }
  } else {
    await db.siteSetting.upsert({
      where: { key },
      create: { key, value: parsed as Prisma.InputJsonValue, updatedById: userId },
      update: { value: parsed as Prisma.InputJsonValue, updatedById: userId },
    });
  }

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
