"use client";

import { useState } from "react";
import type { AdminRole } from "@/generated/prisma/client";
import { adminRoles, formatRole } from "@/lib/auth/rbac";
import { useRouter } from "next/navigation";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  active: boolean;
}

export function UserRoleEditor({ user, currentUserId }: { user: UserRow; currentUserId: string }) {
  const router = useRouter();
  const isSelf = user.id === currentUserId;

  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const updateUser = async (changes: Partial<UserRow>) => {
    setErrorMessage(null);
    const response = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: user.name, role: user.role, active: user.active, ...changes }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(body?.error ?? "Couldn't update this user.");
      return;
    }
    router.refresh();
  };

  const resetPassword = async () => {
    if (!window.confirm(`Reset ${user.name}'s password? Their current password will stop working.`)) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrorMessage(body?.error ?? "Couldn't reset the password.");
        return;
      }
      setTempPassword(body.tempPassword);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const deleteUser = async () => {
    if (!window.confirm(`Permanently delete ${user.name}? This only works for users with no activity history.`)) {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setErrorMessage(body?.error ?? "Couldn't delete this user.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-border/70 align-top">
      <td className="px-4 py-4">
        <p className="font-semibold text-ink">{user.name}</p>
        <p className="text-sm text-muted">{user.email}</p>
        {errorMessage && <p className="mt-1 text-xs text-red-600">{errorMessage}</p>}
        {tempPassword && (
          <div className="mt-2 max-w-xs rounded-lg border border-brand/30 bg-brand/5 p-2 text-xs">
            <p className="text-muted">New temporary password (shown once):</p>
            <p className="select-all font-mono text-sm text-ink">{tempPassword}</p>
          </div>
        )}
      </td>
      <td className="px-4 py-4">
        <select
          value={user.role}
          onChange={(e) => updateUser({ role: e.target.value as AdminRole })}
          disabled={isSelf}
          className="rounded-lg border border-border px-3 py-1.5 text-sm outline-none focus:border-brand"
        >
          {adminRoles.map((role) => (
            <option key={role} value={role}>
              {formatRole(role)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={user.active}
            disabled={isSelf}
            onChange={(e) => updateUser({ active: e.target.checked })}
          />
          Active
        </label>
      </td>
      <td className="px-4 py-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetPassword}
            disabled={busy}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Reset password
          </button>
          {!isSelf && (
            <button
              type="button"
              onClick={deleteUser}
              disabled={busy}
              className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
