"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState } from "react";

// F-163: without a timeout, a hung request (dropped connection, a slow
// upstream) leaves the button stuck on "Signing in..." forever, since the
// original code had no try/catch around fetch to notice the rejection.
const LOGIN_TIMEOUT_MS = 15_000;

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        // F-163: the route already tells these cases apart (423 locked,
        // 429 rate-limited, 5xx server error) — surface that instead of a
        // fixed "Invalid email or password" for every non-2xx response.
        const data = await response.json().catch(() => null);
        if (response.status === 423) {
          setError(
            data?.error ?? "Account temporarily locked. Try again in 15 minutes, or ask a Super Admin to reset your password.",
          );
        } else if (response.status === 429) {
          setError("Too many attempts. Please wait a minute and try again.");
        } else if (response.status >= 500) {
          setError("Couldn't reach the server. Please try again.");
        } else {
          // 400/401: keep this generic so a login attempt never reveals
          // whether the email belongs to an account.
          setError("Invalid email or password");
        }
        setLoading(false);
        return;
      }

      router.push("/admin/dashboard");
      router.refresh();
    } catch (err) {
      clearTimeout(timeoutId);
      setError(
        err instanceof DOMException && err.name === "AbortError"
          ? "The request timed out. Check your connection and try again."
          : "Couldn't reach the server. Check your connection and try again.",
      );
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-3xl border border-border bg-surface-elevated p-8 shadow-lg">
      <div>
        <label htmlFor="email" className="mb-2 block text-sm font-semibold text-ink">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          required
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-2 block text-sm font-semibold text-ink">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-2xl border border-border px-4 py-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </Button>
    </form>
  );
}
