import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { updateHomepageSection } from "@/lib/homepage";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { homepageSectionSchemas, isHomepageSectionKey } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ key: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("homepage:manage");
  if (error) return error;

  const { key } = await params;
  // Release-hardening F-5: `key` used to reach updateHomepageSection()
  // unchecked — an unknown key would silently create/target a
  // HomepageSection row no part of the storefront reads. Match the
  // sibling [key] route's convention (src/app/api/admin/settings/[key]/route.ts).
  if (!isHomepageSectionKey(key)) {
    return NextResponse.json({ error: "Unknown homepage section" }, { status: 404 });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  // Release-hardening F-5: the body used to go straight into
  // updateHomepageSection() with no schema check at all — a wrongly-shaped
  // PUT could (and did, live) corrupt the section's stored content.
  const parsed = homepageSectionSchemas[key].safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const section = await updateHomepageSection(key, parsed.data, session.id);
  return NextResponse.json(section);
}
