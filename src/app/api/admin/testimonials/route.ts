import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { createTestimonial, getAllTestimonialsForAdmin } from "@/lib/testimonials";
import { testimonialSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("testimonials:manage");
  if (error) return error;
  const testimonials = await getAllTestimonialsForAdmin();
  return NextResponse.json(testimonials);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("testimonials:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = testimonialSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  const testimonial = await createTestimonial(parsed.data, session!.id);
  return NextResponse.json(testimonial, { status: 201 });
}
