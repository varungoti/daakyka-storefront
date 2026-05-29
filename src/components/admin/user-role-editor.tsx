"use client";

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

  const updateUser = async (changes: Partial<UserRow>) => {
    await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    router.refresh();
  };

  return (
    <tr className="border-b border-border/70">
      <td className="px-4 py-4">
        <p className="font-semibold text-ink">{user.name}</p>
        <p className="text-sm text-muted">{user.email}</p>
      </td>
      <td className="px-4 py-4">
        <select
          value={user.role}
          onChange={(e) => updateUser({ role: e.target.value as AdminRole, name: user.name, active: user.active })}
          disabled={user.id === currentUserId}
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
            disabled={user.id === currentUserId}
            onChange={(e) =>
              updateUser({ active: e.target.checked, name: user.name, role: user.role })
            }
          />
          Active
        </label>
      </td>
    </tr>
  );
}
