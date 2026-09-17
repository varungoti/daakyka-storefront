import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { markNotificationRead, NotificationNotFoundError } from "@/lib/notifications";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { notificationMarkReadSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("bulk-orders:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = notificationMarkReadSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const notification = await markNotificationRead(id, parsed.data.read, session!.id);
    return NextResponse.json(notification);
  } catch (err) {
    if (err instanceof NotificationNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 });
    }
    throw err;
  }
}
