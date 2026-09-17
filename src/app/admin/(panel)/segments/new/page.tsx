import { redirect } from "next/navigation";
import { SegmentForm } from "@/components/admin/segment-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export default async function NewSegmentPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Segment</h1>
        <p className="text-muted">Define an audience for targeted email and WhatsApp campaigns.</p>
      </div>
      <SegmentForm />
    </div>
  );
}
