import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { updateHomepageSection } from "@/lib/homepage";
import { readJsonBody } from "@/lib/security/parse-json-body";

interface RouteParams {
  params: Promise<{ key: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("homepage:manage");
  if (error) return error;

  const { key } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const section = await updateHomepageSection(key, bodyResult.data, session.id);
  return NextResponse.json(section);
}
