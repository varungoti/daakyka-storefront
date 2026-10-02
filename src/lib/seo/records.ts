import { revalidatePath } from "next/cache";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import type { SeoPageRecord } from "@/generated/prisma/client";
import type { z } from "zod";
import { mergeSeoOverride, type SeoOverride } from "@/lib/seo/apply-override";
import { WIRED_SEO_PATHS, isWiredSeoPath } from "@/lib/seo/wired-paths";
import type { seoPageRecordSchema, seoPageRecordUpdateSchema } from "@/lib/validation/schemas";
import type { Metadata } from "next";

// isWiredSeoPath (src/lib/seo/wired-paths.ts): most wired paths are
// statically prerendered (home in particular is fully static), so an admin
// edit needs an explicit revalidatePath() or it would never show up without
// a full rebuild/redeploy — the whole point of making these editable. Any
// other path is just a recorded override with no live storefront read, so
// there's nothing to revalidate for it.

function safeRevalidatePath(path: string): void {
  if (!isWiredSeoPath(path)) return;
  try {
    revalidatePath(path);
  } catch {
    // No static generation store in this context (unit/integration tests,
    // one-off scripts) — nothing to revalidate. Same defensive pattern as
    // src/lib/catalog/categories.ts's safeRevalidate().
  }
}

/**
 * Admin CRUD for `SeoPageRecord` — per-page title/meta/h1 overrides.
 *
 * Audit gap: "SEO records can't be edited... hardcoded checks plus a
 * sample product schema" (src/app/admin/(panel)/seo/page.tsx only ever
 * read `db.seoPageRecord.findMany()`, with no write path at all).
 *
 * Previously these rows were purely a dashboard/audit display with no
 * storefront read path. getSeoOverrideForPath() / withSeoOverride() below are
 * now called from the generateMetadata() of every page listed in
 * src/lib/seo/wired-paths.ts (home, shop, bulk-orders, about, contact, the
 * guides index and each guide) so an admin override actually reaches
 * <title>/<meta name="description"> there. Category, product and blog pages
 * still generate their metadata from their own content (category and product
 * SEO fields have their own columns); a path outside that list is recorded
 * but never read.
 */

export type SeoPageRecordInput = z.infer<typeof seoPageRecordSchema>;
export type SeoPageRecordUpdateInput = z.infer<typeof seoPageRecordUpdateSchema>;

export class SeoPageRecordNotFoundError extends Error {
  constructor(id: string) {
    super(`SEO record ${id} not found`);
    this.name = "SeoPageRecordNotFoundError";
  }
}

export class SeoPagePathConflictError extends Error {
  constructor(path: string) {
    super(`A SEO record for path "${path}" already exists`);
    this.name = "SeoPagePathConflictError";
  }
}

/** F-052 fix: creating an override for a path the storefront never reads
 * (see isWiredSeoPath) used to silently succeed — the admin saw "created"
 * with no indication it would never apply. Blocks new records and moving
 * an existing record onto an unwired path; existing off-wired rows (created
 * before this fix, or intentionally kept "for reference") can still have
 * their other fields edited as long as the path is left alone. */
export class SeoPagePathNotWiredError extends Error {
  constructor(path: string) {
    super(`"${path}" isn't read live by the storefront yet — pick one of the listed pages`);
    this.name = "SeoPagePathNotWiredError";
  }
}

export async function listSeoRecordsForAdmin(): Promise<SeoPageRecord[]> {
  return db.seoPageRecord.findMany({ orderBy: { path: "asc" } });
}

export async function getSeoRecordForAdmin(id: string): Promise<SeoPageRecord> {
  const record = await db.seoPageRecord.findUnique({ where: { id } });
  if (!record) throw new SeoPageRecordNotFoundError(id);
  return record;
}

async function assertPathAvailable(path: string, excludeId?: string): Promise<void> {
  const existing = await db.seoPageRecord.findUnique({ where: { path }, select: { id: true } });
  if (existing && existing.id !== excludeId) {
    throw new SeoPagePathConflictError(path);
  }
}

export async function createSeoRecord(
  input: SeoPageRecordInput,
  userId: string,
): Promise<SeoPageRecord> {
  if (!isWiredSeoPath(input.path)) {
    throw new SeoPagePathNotWiredError(input.path);
  }
  await assertPathAvailable(input.path);

  const record = await db.seoPageRecord.create({
    data: {
      path: input.path,
      title: input.title,
      metaDescription: input.metaDescription,
      h1: input.h1 ?? null,
      status: input.status ?? "ok",
      issues: input.issues ? JSON.stringify(input.issues) : null,
    },
  });

  await logAuditEvent({
    userId,
    action: "create",
    entity: "seo_page_record",
    entityId: record.id,
    metadata: { path: record.path },
  });

  safeRevalidatePath(record.path);
  return record;
}

export async function updateSeoRecord(
  id: string,
  input: SeoPageRecordUpdateInput,
  userId: string,
): Promise<SeoPageRecord> {
  const existing = await db.seoPageRecord.findUnique({ where: { id } });
  if (!existing) throw new SeoPageRecordNotFoundError(id);

  if (input.path !== undefined && input.path !== existing.path) {
    // F-052: repointing a record at a path the storefront never reads would
    // look "applied" in the admin while doing nothing, exactly what the
    // create guard blocks. Moving onto a wired path is fine, and editing the
    // other fields of a legacy off-wired row (path unchanged) stays allowed.
    if (!isWiredSeoPath(input.path)) {
      throw new SeoPagePathNotWiredError(input.path);
    }
    await assertPathAvailable(input.path, id);
  }

  const updated = await db.seoPageRecord.update({
    where: { id },
    data: {
      ...(input.path !== undefined ? { path: input.path } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.metaDescription !== undefined ? { metaDescription: input.metaDescription } : {}),
      ...(input.h1 !== undefined ? { h1: input.h1 } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.issues !== undefined ? { issues: input.issues ? JSON.stringify(input.issues) : null } : {}),
    },
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "seo_page_record",
    entityId: id,
    metadata: { path: updated.path },
  });

  // Revalidate both the old and new path in case this update just moved
  // the record onto/off of a wired path (e.g. someone repoints an unrelated
  // override to "/shop").
  safeRevalidatePath(existing.path);
  safeRevalidatePath(updated.path);
  return updated;
}

export async function deleteSeoRecord(id: string, userId: string): Promise<void> {
  const existing = await db.seoPageRecord.findUnique({ where: { id } });
  if (!existing) throw new SeoPageRecordNotFoundError(id);

  await db.seoPageRecord.delete({ where: { id } });

  await logAuditEvent({
    userId,
    action: "delete",
    entity: "seo_page_record",
    entityId: id,
    metadata: { path: existing.path },
  });

  safeRevalidatePath(existing.path);
}

/** Storefront read-path: an admin override for a page's <title>/meta
 * description, keyed by its route path (e.g. "/", "/shop"). Never throws —
 * falls back to `null` (letting the caller use its own default metadata)
 * on any DB error, same defensive pattern as
 * src/lib/testimonials/index.ts's getTestimonials(). */
export async function getSeoOverrideForPath(
  path: string,
): Promise<{ title: string; metaDescription: string } | null> {
  try {
    const record = await db.seoPageRecord.findUnique({ where: { path } });
    if (!record) return null;
    return { title: record.title, metaDescription: record.metaDescription };
  } catch {
    return null;
  }
}

/** Every stored override whose path the storefront actually reads (see
 * WIRED_SEO_PATHS), in one query — for the admin SEO audit, which would
 * otherwise do one lookup per wired page. Never throws (returns an empty map
 * on a DB error), same as getSeoOverrideForPath. */
export async function listLiveSeoOverrides(): Promise<Map<string, SeoOverride>> {
  try {
    const records = await db.seoPageRecord.findMany({
      where: { path: { in: [...WIRED_SEO_PATHS] } },
      select: { path: true, title: true, metaDescription: true },
    });
    return new Map(records.map((record) => [record.path, { title: record.title, metaDescription: record.metaDescription }]));
  } catch {
    return new Map();
  }
}

/** F-052: a page's own metadata with the admin override for `path` (if one is
 * stored) laid over its title and description — what each wired page's
 * generateMetadata() returns. Falls back to `base` unchanged when there is no
 * override or the lookup fails. */
export async function withSeoOverride(path: string, base: Metadata): Promise<Metadata> {
  if (!isWiredSeoPath(path)) return base;
  return mergeSeoOverride(base, await getSeoOverrideForPath(path));
}
