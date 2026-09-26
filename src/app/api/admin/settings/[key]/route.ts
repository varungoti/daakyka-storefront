import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/admin-api";
import { hasPermission } from "@/lib/auth/rbac";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { isSettingKey, setSetting, settingSchemas } from "@/lib/settings";
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

  const bodyResult = await readJsonBody<{ value: unknown }>(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsedValue = settingSchemas[key].safeParse(bodyResult.data?.value);
  if (!parsedValue.success) {
    return NextResponse.json(
      { error: "Invalid value", issues: parsedValue.error.issues },
      { status: 400 },
    );
  }

  const value = await setSetting(key, parsedValue.data, session.id);
  return NextResponse.json({ key, value });
}
