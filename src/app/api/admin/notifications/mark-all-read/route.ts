import { NextResponse } from "next/server";
import { NOTIFICATIONS_PAGE_PERMISSIONS } from "@/lib/admin/notifications-access";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { markAllNotificationsRead } from "@/lib/notifications";

// F-268: matches the page's own (now multi-permission) access rule — see
// src/lib/admin/notifications-access.ts — so a role that can now see the
// notifications list (e.g. MARKETING_ADMIN) can also mark it read.
export async function POST() {
  const { session, error } = await requireAdminPermission(NOTIFICATIONS_PAGE_PERMISSIONS);
  if (error) return error;

  const count = await markAllNotificationsRead(session!.id);
  return NextResponse.json({ success: true, count });
}
