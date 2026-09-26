import { revalidateTag, unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import type { Testimonial } from "@/lib/types";
import { logAuditEvent } from "@/lib/auth/audit";
import type { TestimonialRecord } from "@/generated/prisma/client";
import type { z } from "zod";
import type { testimonialSchema, testimonialUpdateSchema } from "@/lib/validation/schemas";

export type TestimonialInput = z.infer<typeof testimonialSchema>;
export type TestimonialUpdateInput = z.infer<typeof testimonialUpdateSchema>;

export class TestimonialNotFoundError extends Error {
  constructor(id: string) {
    super(`Testimonial ${id} not found`);
    this.name = "TestimonialNotFoundError";
  }
}

function mapRecord(record: {
  id: string;
  quote: string;
  name: string;
  title: string;
  rating: number;
  avatar: string;
}): Testimonial {
  return {
    id: record.id,
    quote: record.quote,
    name: record.name,
    title: record.title,
    rating: record.rating,
    avatar: record.avatar,
  };
}

// F-005: no hardcoded fallback. Zero active rows means zero testimonials
// — TestimonialsSection already renders nothing for an empty list — so
// hiding or deleting every testimonial in /admin/testimonials actually
// results in an empty homepage section, not a return of fabricated
// reviews. Errors are deliberately NOT swallowed here: this function is
// wrapped by unstable_cache below, and catching inside it would cache a
// transient DB error's fallback value under the "testimonials" tag until
// the next revalidation. getTestimonials() catches instead.
async function readTestimonialsFromDb(): Promise<Testimonial[]> {
  const records = await db.testimonialRecord.findMany({
    where: { active: true },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return records.map((r) => mapRecord(r));
}

// Cached with Next's data cache, tagged "testimonials" so the admin CRUD
// below can invalidate it via revalidateTag — same pattern as
// src/lib/settings/index.ts's getSetting().
export const TESTIMONIALS_CACHE_TAG = "testimonials";

const cachedGetTestimonials = unstable_cache(
  readTestimonialsFromDb,
  ["active-testimonials"],
  { tags: [TESTIMONIALS_CACHE_TAG] },
);

export async function getTestimonials(): Promise<Testimonial[]> {
  try {
    return await cachedGetTestimonials();
  } catch (error) {
    // Two different failures land here, both handled the same way:
    // (1) unstable_cache needs Next's incremental cache / request store,
    // which isn't present outside an actual Next server (unit tests,
    // scripts, etc) — fall back to an uncached read; (2) readTestimonialsFromDb
    // itself threw (a real DB error). Either way, never show fabricated
    // testimonials (F-005) — an empty list just hides the section.
    try {
      return await readTestimonialsFromDb();
    } catch (dbError) {
      console.error("[testimonials] failed to load testimonials", dbError ?? error);
      return [];
    }
  }
}

/**
 * Invalidates the cached getTestimonials() read. Split out (rather than
 * inlining revalidateTag in each CRUD function below) so it's
 * independently testable — see src/lib/homepage/index.ts's
 * revalidateHomepageCache() for why: next/cache's exports can't be
 * mocked from a test (non-configurable accessor properties, and this
 * project's tests run as real ESM anyway), so tests inject a fake
 * `revalidate` here instead of spying on the real one.
 */
export function revalidateTestimonialsCache(
  revalidate: (tag: string, profile: string) => void = revalidateTag,
): void {
  try {
    revalidate(TESTIMONIALS_CACHE_TAG, "max");
  } catch {
    // No static generation store in this context (unit/integration tests,
    // one-off scripts) — nothing to revalidate.
  }
}

export async function getAllTestimonialsForAdmin() {
  return db.testimonialRecord.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
}

export async function getTestimonialForAdmin(id: string): Promise<TestimonialRecord> {
  const record = await db.testimonialRecord.findUnique({ where: { id } });
  if (!record) throw new TestimonialNotFoundError(id);
  return record;
}

// getTestimonials() above is cached via unstable_cache and tagged
// TESTIMONIALS_CACHE_TAG. src/app/page.tsx ("/") is fully static, so it
// bakes that read into its prerendered HTML at build time regardless of
// caching — every write below calls revalidateTestimonialsCache(), or an
// edit would never reach the live site short of a full redeploy.
// src/app/shop/page.tsx and src/app/category/[slug]/page.tsx render
// per-request (both read `searchParams`, which opts a route out of static
// rendering), so they'd pick up a write on their very next request
// regardless of tagging — but they still share the same cached Data Cache
// entry getTestimonials() populates, so revalidating the tag keeps them
// consistent too. getAllTestimonialsForAdmin()/getTestimonialForAdmin()
// are intentionally left uncached — the admin UI should always show live
// data. See src/lib/homepage/index.ts's HOMEPAGE_CACHE_TAG comment for the
// doc citation on why revalidateTag alone (no revalidatePath) is
// sufficient for the static route.

export async function createTestimonial(
  input: TestimonialInput,
  userId: string,
): Promise<TestimonialRecord> {
  const created = await db.testimonialRecord.create({ data: input });

  await logAuditEvent({
    userId,
    action: "create",
    entity: "testimonial",
    entityId: created.id,
  });

  revalidateTestimonialsCache();
  return created;
}

export async function updateTestimonial(
  id: string,
  input: TestimonialUpdateInput,
  userId: string,
): Promise<TestimonialRecord> {
  const existing = await db.testimonialRecord.findUnique({ where: { id } });
  if (!existing) throw new TestimonialNotFoundError(id);

  const updated = await db.testimonialRecord.update({ where: { id }, data: input });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "testimonial",
    entityId: id,
    metadata: input,
  });

  revalidateTestimonialsCache();
  return updated;
}

export async function deleteTestimonial(id: string, userId: string): Promise<void> {
  const existing = await db.testimonialRecord.findUnique({ where: { id } });
  if (!existing) throw new TestimonialNotFoundError(id);

  await db.testimonialRecord.delete({ where: { id } });

  await logAuditEvent({
    userId,
    action: "delete",
    entity: "testimonial",
    entityId: id,
    metadata: { name: existing.name },
  });

  revalidateTestimonialsCache();
}
