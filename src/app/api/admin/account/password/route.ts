import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { createSession } from "@/lib/auth/session";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { adminChangePasswordSchema } from "@/lib/validation/schemas";
import {
  AccountLockedForPasswordChangeError,
  changeOwnPassword,
  CurrentPasswordIncorrectError,
  UserNotFoundError,
  WeakPasswordError,
} from "@/lib/auth/user-admin";

/**
 * F-057: self-service admin password change. Every admin can reach this
 * (permission is "dashboard:view", which every AdminRole has — see
 * src/lib/auth/rbac.ts — not "users:manage", which only SUPER_ADMIN has
 * and would leave every other role still unable to rotate their own
 * password). See src/lib/auth/user-admin.ts's changeOwnPassword for the
 * actual verification/lockout/update logic this route just maps to HTTP.
 */
export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("dashboard:view");
  if (error) return error;

  const limited = await rateLimitOrResponse(request, "admin-change-password", 5, 60_000);
  if (limited) return limited;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = adminChangePasswordSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { sessionVersion } = await changeOwnPassword(
      session!.id,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );

    // Changing the password bumps sessionVersion, which would otherwise
    // reject this very request's own session cookie on its next use and
    // sign the caller out before they see confirmation — re-issue it here
    // with the bumped version, mirroring the reset-password route's own
    // "reset your own password" case (src/app/api/admin/users/[id]/
    // reset-password/route.ts).
    await createSession(
      { id: session!.id, email: session!.email, name: session!.name, role: session!.role },
      sessionVersion,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AccountLockedForPasswordChangeError) {
      return NextResponse.json({ error: err.message }, { status: 423 });
    }
    if (err instanceof CurrentPasswordIncorrectError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof WeakPasswordError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    throw err;
  }
}
