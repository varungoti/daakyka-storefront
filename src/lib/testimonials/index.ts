import { db } from "@/lib/db";
import { testimonials as seedTestimonials } from "@/data/testimonials";
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

export async function getTestimonials(): Promise<Testimonial[]> {
  try {
    const records = await db.testimonialRecord.findMany({
      where: { active: true },
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    });
    if (records.length === 0) return seedTestimonials;
    return records.map((r) => mapRecord(r));
  } catch {
    return seedTestimonials;
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

// Note: getTestimonials()/getAllTestimonialsForAdmin() read straight from
// the DB (no unstable_cache wrapper, unlike src/lib/settings/index.ts or
// src/lib/catalog/categories.ts), and the storefront pages that render
// testimonials (src/app/page.tsx, src/app/shop/page.tsx,
// src/app/category/[slug]/page.tsx) don't set `revalidate`/`dynamic`
// either — so there's no cache tag to invalidate here. Writes are visible
// on the next request without a revalidateTag() call.

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
}
