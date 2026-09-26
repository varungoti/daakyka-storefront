import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin-api";
import { hasPermission } from "@/lib/auth/rbac";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { isSettingKey, setSetting, settingSchemas, StaleSettingError } from "@/lib/settings";
import { settingPermissions } from "@/lib/settings/permissions";

interface RouteParams {
  params: Promise<{ key: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  // F-061 fix: this used to be a single `requireAdminPermission("settings:manage")`
  // gate for every key, so MARKETING_ADMIN — granted that one blanket
  // permission — could change shipping rates and the public contact
  // details/order-alert inbox, despite being documented as "limited to
  // sale/announcement settings". Session and permission are now checked
  // separately so the permission can depend on which key is being written.
  const { session, error } = await requireAdminSession();
  if (error) return error;

  const { key } = await params;
  if (!isSettingKey(key)) {
    return NextResponse.json({ error: "Unknown setting key" }, { status: 404 });
  }

  if (!hasPermission(session.role, settingPermissions[key])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bodyResult = await readJsonBody<{ value: unknown; updatedAt?: string }>(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsedValue = settingSchemas[key].safeParse(bodyResult.data?.value);
  if (!parsedValue.success) {
    return NextResponse.json(
      { error: "Invalid value", issues: parsedValue.error.issues },
      { status: 400 },
    );
  }

  // F-343: an editor that loaded this setting can send back the `updatedAt`
  // it was loaded with (see GET's response shape) so a save that's gone
  // stale in the meantime — someone else saved this same key first — is
  // rejected with 409 instead of silently winning. Optional: an editor that
  // hasn't been updated to send it yet keeps writing unconditionally.
  const expectedUpdatedAt = bodyResult.data?.updatedAt ? new Date(bodyResult.data.updatedAt) : undefined;
  if (expectedUpdatedAt && Number.isNaN(expectedUpdatedAt.getTime())) {
    return NextResponse.json({ error: "Invalid updatedAt" }, { status: 400 });
  }

  try {
    const value = await setSetting(key, parsedValue.data, session.id, expectedUpdatedAt);
    return NextResponse.json({ key, value });
  } catch (err) {
    if (err instanceof StaleSettingError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
