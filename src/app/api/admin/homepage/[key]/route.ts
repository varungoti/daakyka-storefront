import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import {
  HomepageSectionNotFoundError,
  StaleHomepageSectionError,
  updateHomepageSection,
} from "@/lib/homepage";
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

  // F-343: an editor that loaded this section can send back the
  // `updatedAt` it was loaded with as a query param — the request body
  // here *is* the section's content (validated above against its own
  // schema), so there's no spare body field to carry it. As a query param
  // it's optional: an editor that hasn't been updated to send it yet keeps
  // writing unconditionally, same as before this fix.
  const updatedAtParam = new URL(request.url).searchParams.get("updatedAt");
  const expectedUpdatedAt = updatedAtParam ? new Date(updatedAtParam) : undefined;
  if (expectedUpdatedAt && Number.isNaN(expectedUpdatedAt.getTime())) {
    return NextResponse.json({ error: "Invalid updatedAt" }, { status: 400 });
  }

  try {
    const section = await updateHomepageSection(key, parsed.data, session.id, expectedUpdatedAt);
    return NextResponse.json(section);
  } catch (err) {
    if (err instanceof HomepageSectionNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof StaleHomepageSectionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
