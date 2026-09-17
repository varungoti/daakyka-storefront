import { notFound, redirect } from "next/navigation";
import { TestimonialForm } from "@/components/admin/testimonial-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getTestimonialForAdmin, TestimonialNotFoundError } from "@/lib/testimonials";

export default async function EditTestimonialPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "testimonials:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const testimonial = await getTestimonialForAdmin(id).catch((err) => {
    if (err instanceof TestimonialNotFoundError) return null;
    throw err;
  });

  if (!testimonial) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Testimonial</h1>
        <p className="text-muted">{testimonial.name}</p>
      </div>
      <TestimonialForm initial={testimonial} />
    </div>
  );
}
