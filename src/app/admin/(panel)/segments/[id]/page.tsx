import { notFound, redirect } from "next/navigation";
import { SegmentForm } from "@/components/admin/segment-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { getSegmentForAdmin, SegmentNotFoundError } from "@/lib/engagement/segments";

export default async function EditSegmentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const segment = await getSegmentForAdmin(id).catch((err) => {
    if (err instanceof SegmentNotFoundError) return null;
    throw err;
  });

  if (!segment) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Segment</h1>
        <p className="text-muted">{segment.name}</p>
      </div>
      <SegmentForm initial={segment} />
    </div>
  );
}
