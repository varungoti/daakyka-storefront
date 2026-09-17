import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { markAllNotificationsRead } from "@/lib/notifications";

export async function POST() {
  const { session, error } = await requireAdminPermission("bulk-orders:manage");
  if (error) return error;

  const count = await markAllNotificationsRead(session!.id);
  return NextResponse.json({ success: true, count });
}
