"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";

export function ForgotPasswordForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setStatus("loading");

    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/account/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      // The API always returns the same generic response regardless of
      // whether the email exists — we show that message either way and
      // never branch UI on response.ok for this endpoint's normal path.
      if (response.status === 429) {
        setStatus("error");
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div className="rounded-3xl border border-trust/30 bg-trust/10 p-8 text-center">
        <h2 className="font-display text-xl font-bold text-ink">Check Your Email</h2>
        <p className="mt-2 text-sm text-muted">
          If an account exists for that email, a password reset link is on its way.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-border bg-surface-elevated p-8">
      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-semibold text-ink">
          Email *
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
      {status === "error" && (
        <p className="text-sm text-red-600">Too many attempts. Please wait a moment and try again.</p>
      )}
      <Button type="submit" className="w-full" disabled={status === "loading"}>
        {status === "loading" ? "Sending..." : "Send Reset Link"}
      </Button>
    </form>
  );
}
