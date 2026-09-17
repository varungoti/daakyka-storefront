import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { resetUserPassword, UserNotFoundError } from "@/lib/auth/user-admin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Admin-triggered password reset: generates a new temp password (see
 * src/lib/auth/user-admin.ts / src/lib/auth/temp-password.ts), hashes it
 * into User.passwordHash, and returns it once. Also bumps sessionVersion
 * so any session already issued to this user is invalidated immediately
 * (same v1 2.3 revocation the PATCH route uses for role/active changes).
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("users:manage");
  if (error) return error;

  const { id } = await params;

  try {
    const result = await resetUserPassword(id, session!.id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    throw err;
  }
}
