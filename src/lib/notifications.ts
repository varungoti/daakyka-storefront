import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import { Prisma, type AdminNotification, type AdminRole } from "@/generated/prisma/client";
import { visibleNotificationFilter } from "@/lib/admin/notifications-access";

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

export async function getUnreadNotificationCount(role: AdminRole): Promise<number> {
  try {
    return await db.adminNotification.count({ where: { ...visibleNotificationFilter(role), read: false } });
  } catch {
    return 0;
  }
}

export async function markNotificationRead(
  id: string,
  read: boolean,
  userId: string,
  role: AdminRole,
): Promise<AdminNotification> {
  const updated = await db.adminNotification.update({
    where: { id, ...visibleNotificationFilter(role) },
    data: { read },
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new NotificationNotFoundError(id);
    }
    throw error;
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "admin_notification",
    entityId: id,
    metadata: { read },
  });

  return updated;
}

export async function markAllNotificationsRead(userId: string, role: AdminRole): Promise<number> {
  const result = await db.adminNotification.updateMany({
    where: { ...visibleNotificationFilter(role), read: false },
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
