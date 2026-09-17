import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  deleteTestimonial,
  getTestimonialForAdmin,
  TestimonialNotFoundError,
  updateTestimonial,
} from "@/lib/testimonials";
import { testimonialUpdateSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("testimonials:manage");
  if (error) return error;

  const { id } = await params;
  try {
    const testimonial = await getTestimonialForAdmin(id);
    return NextResponse.json(testimonial);
  } catch (err) {
    if (err instanceof TestimonialNotFoundError) {
      return NextResponse.json({ error: "Testimonial not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("testimonials:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = testimonialUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const testimonial = await updateTestimonial(id, parsed.data, session!.id);
    return NextResponse.json(testimonial);
  } catch (err) {
    if (err instanceof TestimonialNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Testimonial not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("testimonials:manage");
  if (error) return error;

  const { id } = await params;
  try {
    await deleteTestimonial(id, session!.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof TestimonialNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Testimonial not found" }, { status: 404 });
    }
    throw err;
  }
}
