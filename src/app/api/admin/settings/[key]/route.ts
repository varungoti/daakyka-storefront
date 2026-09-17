import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { isSettingKey, setSetting, settingSchemas } from "@/lib/settings";

interface RouteParams {
  params: Promise<{ key: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("settings:manage");
  if (error) return error;

  const { key } = await params;
  if (!isSettingKey(key)) {
    return NextResponse.json({ error: "Unknown setting key" }, { status: 404 });
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
