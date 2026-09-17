"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminRoles, formatRole } from "@/lib/auth/rbac";
import type { AdminRole } from "@/generated/prisma/client";

export function UserInviteForm() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AdminRole>("VIEWER");

  const [status, setStatus] = useState<"idle" | "saving" | "error" | "done">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);

  const invite = async () => {
    setStatus("saving");
    setErrorMessage(null);

    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus("error");
      setErrorMessage(body?.error ?? "Couldn't create the user — check the fields above.");
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
          Share this temporary password with them now — it will not be shown again. They should
          sign in and change it as soon as possible.
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
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>
      <Field label="Role">
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

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}
