import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { JourneyNotFoundError, updateJourneyStatus } from "@/lib/engagement/journeys";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

const schema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { session, error } = await requireAdminPermission("journeys:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  try {
    const journey = await updateJourneyStatus(id, parsed.data.status, session!.id);
    return NextResponse.json(journey);
  } catch (err) {
    // F-219: an unknown/deleted id used to crash with an unhandled 500.
    if (err instanceof JourneyNotFoundError) {
      return NextResponse.json({ error: "Journey not found" }, { status: 404 });
    }
    throw err;
  }
}
