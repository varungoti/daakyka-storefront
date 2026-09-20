import { LoginForm } from "@/components/admin/login-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin Login",
  robots: { index: false, follow: false },
};

export default function AdminLoginPage() {
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
