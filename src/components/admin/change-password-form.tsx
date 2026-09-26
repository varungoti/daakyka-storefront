"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * F-057: the "Change password" form every admin uses to rotate their own
 * password — the only self-service option before this was a SUPER_ADMIN
 * generating another random temp password for someone else. Posts to
 * POST /api/admin/account/password (src/lib/auth/user-admin.ts's
 * changeOwnPassword does the actual verify/lockout/update).
 */
export function ChangePasswordForm({ forced = false }: { forced?: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (newPassword !== confirmPassword) {
      setStatus("error");
      setErrorMessage("New password and confirmation don't match.");
      return;
    }

    setStatus("saving");
    try {
      const response = await fetch("/api/admin/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setStatus("error");
        if (response.status === 429) {
          setErrorMessage("Too many attempts. Please wait a moment and try again.");
        } else if (response.status === 423) {
          setErrorMessage(data?.error ?? "Too many incorrect attempts. Try again later.");
        } else {
          const fieldMessage = Object.values(
            (data?.details?.fieldErrors as Record<string, string[]> | undefined) ?? {},
          )[0]?.[0];
          setErrorMessage(fieldMessage ?? data?.error ?? "Couldn't change your password.");
        }
        return;
      }

      setStatus("done");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      // The session cookie was just re-issued by the route with the
      // bumped sessionVersion — refresh so the rest of the shell (and,
      // when forced, the redirect gate in admin-shell.tsx) picks up the
      // cleared mustChangePassword flag on the next request.
      router.refresh();
    } catch {
      setStatus("error");
      setErrorMessage("Something went wrong. Please try again.");
    }
  };

  if (status === "done") {
    return (
      <div className="max-w-md space-y-3 rounded-2xl border border-trust/30 bg-trust/10 p-6">
        <p className="font-semibold text-ink">Password changed</p>
        <p className="text-sm text-muted">You&apos;re still signed in on this device.</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-md space-y-4 rounded-2xl border border-border bg-surface p-6"
    >
      {forced && (
        <p className="rounded-xl bg-lilac/40 p-3 text-sm text-ink">
          Set your own password to continue — the temporary one you signed in with needs to be
          changed first.
        </p>
      )}
      <Field label="Current password">
        <input
          type="password"
          autoComplete="current-password"
          required
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>
      <Field label="New password">
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>
      <Field label="Confirm new password">
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      <button
        type="submit"
        disabled={status === "saving"}
        className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "saving" ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}
