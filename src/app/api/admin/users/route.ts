import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { inviteUser, UserEmailConflictError } from "@/lib/auth/user-admin";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { userInviteSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("users:manage");
  if (error) return error;

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json(users);
}

/**
 * Invite/create an admin user (audit gap: "No create, invite, delete or
 * password reset"). See src/lib/auth/temp-password.ts's header comment
 * for why this returns a one-time temp password instead of emailing a
 * reset link.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("users:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = userInviteSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    // tempPassword is returned exactly once and never logged or stored —
    // only its bcrypt hash persists in User.passwordHash.
    const result = await inviteUser(parsed.data, session!.id);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UserEmailConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
