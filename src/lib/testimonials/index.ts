import { db } from "@/lib/db";
import { testimonials as seedTestimonials } from "@/data/testimonials";
import type { Testimonial } from "@/lib/types";

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
