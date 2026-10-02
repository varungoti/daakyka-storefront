"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { adminRoles, formatRole } from "@/lib/auth/rbac";
import { formatApiError } from "@/lib/validation/format-api-error";
import type { AdminRole } from "@/generated/prisma/client";

export function UserInviteForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("VIEWER");

  const [status, setStatus] = useState<"idle" | "saving" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  const invite = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});

    let response: Response;
    try {
      response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
    } catch {
      setStatus("error");
      setErrorMessage("Couldn't create the user — check your connection and try again.");
      return;
    }

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // F-172: an invalid email showed only the generic "Validation failed"
      // — the route's `issues` carry the per-field reason.
      const { summary, fieldErrors: fe } = formatApiError(body, "Couldn't create the user — check the fields above.");
      setStatus("error");
      setErrorMessage(summary);
      setFieldErrors(fe);
      return;
    }

    setStatus("done");
    setTempPassword(body.tempPassword);
    setCreatedEmail(body.user?.email ?? email.trim());
    setName("");
    setEmail("");
    setRole("VIEWER");
    router.refresh();
  };

  if (status === "done" && tempPassword) {
    return (
      <div className="max-w-lg space-y-3 rounded-2xl border border-brand/30 bg-brand/5 p-6">
        <p className="font-semibold text-ink">
          User created: <span className="font-mono">{createdEmail}</span>
        </p>
        <p className="text-sm text-muted">
          Share this temporary password with them now — it will not be shown again. They&apos;ll be
          asked to set their own password (Account → Change Password) the moment they sign in.
        </p>
        <p className="select-all rounded-xl border border-border bg-surface p-3 font-mono text-lg tracking-wider text-ink">
          {tempPassword}
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-lilac/40"
        >
          Invite another
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-4 rounded-2xl border border-border bg-surface p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={fieldErrors.name}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Email" error={fieldErrors.email}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>
      <Field label="Role" error={fieldErrors.role}>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRole)}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        >
          {adminRoles.map((r) => (
            <option key={r} value={r}>
              {formatRole(r)}
            </option>
          ))}
        </select>
      </Field>

      <FormErrorBanner message={errorMessage} />

      <button
        type="button"
        onClick={invite}
        disabled={status === "saving" || !name.trim() || !email.trim()}
        className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "saving" ? "Creating…" : "Invite user"}
      </button>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11px] text-red-600">{error}</span> : null}
    </label>
  );
}
