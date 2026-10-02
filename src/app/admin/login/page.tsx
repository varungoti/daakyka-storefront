import { LoginForm } from "@/components/admin/login-form";
import { getSession } from "@/lib/auth/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Admin Login",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage() {
  // F-171: an already-signed-in admin who opened /admin/login (a bookmark,
  // the Back button) was shown the sign-in form again instead of being
  // taken to their dashboard. getSession() is the full DB-backed check
  // (still active, session not revoked), so a stale cookie still sees the
  // form — and the (panel) layout, which redirects here on any non-ok
  // session, can never loop back.
  if (await getSession()) {
    redirect("/admin/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-lavender/40 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">DAAKYKA</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">Admin Sign In</h1>
        </div>
        <LoginForm />
        {/* F-17 (docs/audit-2026-09-19/admin-ux.md): a short recovery hint
            rather than a self-serve reset flow — `users:manage` (Users →
            Reset password) is intentionally SUPER_ADMIN-only, so this
            deliberately doesn't add a "forgot password" link/flow here. */}
        <p className="mt-6 text-center text-sm text-muted">
          Locked out? Ask a Super Admin to reset your password from Users.
        </p>
      </div>
    </div>
  );
}
