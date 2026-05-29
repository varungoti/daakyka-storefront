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
      </div>
    </div>
  );
}
