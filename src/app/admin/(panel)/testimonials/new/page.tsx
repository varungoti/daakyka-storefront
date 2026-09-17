import { redirect } from "next/navigation";
import { TestimonialForm } from "@/components/admin/testimonial-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewTestimonialPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "testimonials:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Testimonial</h1>
        <p className="text-muted">Add a customer quote to show on the homepage and shop.</p>
      </div>
      <TestimonialForm />
    </div>
  );
}
