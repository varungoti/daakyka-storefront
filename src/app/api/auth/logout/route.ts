import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { destroySession, getSession } from "@/lib/auth/session";

export async function POST() {
  const session = await getSession();
  if (session) {
    await logAuditEvent({
      userId: session.id,
      action: "logout",
      entity: "user",
      entityId: session.id,
    });
  }

  await destroySession();
  return NextResponse.json({ success: true });
}
