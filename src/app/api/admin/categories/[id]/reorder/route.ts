import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { CategoryNotFoundError, reorderCategory } from "@/lib/catalog/categories";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const reorderSchema = z.object({ direction: z.enum(["up", "down"]) });

/** Swaps sortOrder with the previous/next sibling — backs the tree view's
 * up/down controls (drag-and-drop is optional per the plan). */
export async function POST(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = reorderSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const moved = await reorderCategory(id, parsed.data.direction, session.id);
    return NextResponse.json({ moved });
  } catch (err) {
    if (err instanceof CategoryNotFoundError) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    throw err;
  }
}
