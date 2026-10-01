"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  // F-137: the account was locked out (423) — show a way out (reset the
  // password) instead of leaving the shopper to just wait 15 minutes.
  const [locked, setLocked] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setStatus("loading");
    setError("");

    const form = new FormData(formElement);
    setLocked(false);
    try {
      const response = await fetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setStatus("error");
        if (response.status === 423) {
          setError(data?.error ?? "Too many failed attempts. Try again in 15 minutes, or reset your password.");
          setLocked(true);
        } else if (response.status === 429) {
          setError("Too many attempts. Please wait a moment and try again.");
        } else if (response.status >= 500) {
          // F-326: a limiter DB outage now fails closed (503) rather than
          // silently letting the attempt through.
          setError(data?.error ?? "Couldn't reach the server. Please try again shortly.");
        } else {
          setError(data?.error ?? "Invalid email or password.");
        }
        return;
      }

      router.push(returnTo);
      router.refresh();
    } catch {
      setStatus("error");
      setError("Something went wrong. Please try again.");
    }
  };

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
      <div>
        <div className="mb-2 flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-semibold text-ink">
            Password *
          </label>
          <Link href="/account/forgot-password" className="text-xs font-semibold text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
          {locked && (
            <>
              {" "}
              <Link href="/account/forgot-password" className="font-semibold underline">
                Reset password
              </Link>
            </>
          )}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={status === "loading"}>
        {status === "loading" ? "Signing in..." : "Sign In"}
      </Button>
      <p className="text-center text-sm text-muted">
        Don&apos;t have an account?{" "}
        <Link
          href={`/account/register?returnTo=${encodeURIComponent(returnTo)}`}
          className="font-semibold text-brand hover:underline"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}
