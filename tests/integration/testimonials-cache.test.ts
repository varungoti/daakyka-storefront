import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createTestimonial, deleteTestimonial, getTestimonials, updateTestimonial } from "@/lib/testimonials";
import { findAnyAdminId } from "../helpers/admin-user";

function fixture(name: string) {
  return {
    quote: "Cache round-trip coverage quote, long enough to pass validation.",
    name,
    title: "Ward Nurse",
    rating: 5,
    avatar: "https://example.com/avatar.jpg",
    featured: false,
    active: true,
    sortOrder: 0,
  };
}

/**
 * Covers the P0 fix: an admin's testimonial create/update/delete reaching
 * the live storefront. getTestimonials() is read by src/app/page.tsx
 * (fully static "/"), src/app/shop/page.tsx, and
 * src/app/category/[slug]/page.tsx. See src/lib/testimonials/index.ts and
 * src/lib/testimonials/index.test.ts for the revalidateTestimonialsCache()
 * injection-contract unit coverage (next/cache's real exports can't be
 * spied on). This test covers the other half: the DB write is visible
 * through the exact getter those pages call — see
 * tests/integration/homepage-cache.test.ts for why this exercises
 * getTestimonials()'s uncached fallback path rather than a real cache hit
 * outside a Next.js server.
 */
describe("testimonials cache round trip", () => {
  let adminId: string;
  const createdIds: string[] = [];

  before(async () => {
    adminId = await findAnyAdminId();
  });

  after(async () => {
    if (createdIds.length) {
      await db.testimonialRecord.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
    }
  });

  it("createTestimonial's write is visible through getTestimonials()", async () => {
    const testimonial = await createTestimonial(
      fixture(`Integration Test Reviewer ${randomUUID().slice(0, 8)}`),
      adminId,
    );
    createdIds.push(testimonial.id);

    const visible = await getTestimonials();
    assert.ok(
      visible.some((t) => t.id === testimonial.id),
      "newly created active testimonial should appear in getTestimonials()",
    );
  });

  it("updateTestimonial's write (toggling active off) is visible through getTestimonials()", async () => {
    const testimonial = await createTestimonial(
      fixture(`Integration Test Reviewer ${randomUUID().slice(0, 8)}`),
      adminId,
    );
    createdIds.push(testimonial.id);
    assert.ok((await getTestimonials()).some((t) => t.id === testimonial.id));

    await updateTestimonial(testimonial.id, { active: false }, adminId);

    const visible = await getTestimonials();
    assert.ok(
      !visible.some((t) => t.id === testimonial.id),
      "deactivated testimonial should no longer appear in getTestimonials()",
    );
  });

  it("deleteTestimonial's write is visible through getTestimonials()", async () => {
    const testimonial = await createTestimonial(
      fixture(`Integration Test Reviewer ${randomUUID().slice(0, 8)}`),
      adminId,
    );
    createdIds.push(testimonial.id);
    assert.ok((await getTestimonials()).some((t) => t.id === testimonial.id));

    await deleteTestimonial(testimonial.id, adminId);
    createdIds.splice(createdIds.indexOf(testimonial.id), 1);

    const visible = await getTestimonials();
    assert.ok(
      !visible.some((t) => t.id === testimonial.id),
      "deleted testimonial should no longer appear in getTestimonials()",
    );
  });
});
