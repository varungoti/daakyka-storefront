import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import type { AdminNotification } from "@/generated/prisma/client";

/**
 * `markNotificationRead`/`markAllNotificationsRead` below set
 * `AdminNotification.read` (it starts `false`, the column default, at
 * creation) — mark-as-read is implemented, not a gap.
 *
 * There's no dedicated `notifications:manage` permission in
 * src/lib/auth/rbac.ts; the notifications page and its nav item already
 * gate on `bulk-orders:manage` (see src/app/admin/(panel)/notifications/
 * page.tsx and src/components/admin/admin-shell.tsx), so the routes here
 * reuse that same permission rather than inventing a new one.
 */

export class NotificationNotFoundError extends Error {
  constructor(id: string) {
    super(`Notification ${id} not found`);
    this.name = "NotificationNotFoundError";
  }
}

export async function getUnreadNotificationCount(): Promise<number> {
  try {
    return await db.adminNotification.count({ where: { read: false } });
  } catch {
    return 0;
  }
}

export async function markNotificationRead(
  id: string,
  read: boolean,
  userId: string,
): Promise<AdminNotification> {
  const existing = await db.adminNotification.findUnique({ where: { id } });
  if (!existing) throw new NotificationNotFoundError(id);

  const updated = await db.adminNotification.update({ where: { id }, data: { read } });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "admin_notification",
    entityId: id,
    metadata: { read },
  });

  return updated;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await db.adminNotification.updateMany({
    where: { read: false },
    data: { read: true },
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "admin_notification",
    metadata: { markAllRead: true, count: result.count },
  });

  return result.count;
}
