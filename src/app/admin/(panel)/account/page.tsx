import { ChangePasswordForm } from "@/components/admin/change-password-form";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Account" };

interface PageProps {
  searchParams: Promise<{ required?: string }>;
}

/**
 * F-057: the admin-facing "change your own password" page — previously
 * nonexistent, even though the invite screen already told new admins to
 * "sign in and change it as soon as possible" (user-invite-form.tsx).
 * Every AdminRole has "dashboard:view" (see src/lib/auth/rbac.ts), so
 * this is reachable by every role, not just SUPER_ADMIN.
 *
 * `?required=1` is set by the server-side page/session gate when
 * `mustChangePassword` is still set on the signed-in admin (a fresh
 * invite, or an admin-triggered reset). The API gate independently blocks
 * all admin actions except changing the password.
 */
export default async function AdminAccountPage({ searchParams }: PageProps) {
  await requireAdminPage("dashboard:view");
  const { required } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Account</h1>
        <p className="text-muted">Change the password for your own admin account.</p>
      </div>
      <ChangePasswordForm forced={required === "1"} />
    </div>
  );
}
