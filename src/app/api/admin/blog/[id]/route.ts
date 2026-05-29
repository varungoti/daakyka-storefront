import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { blogPostSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("blog:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = blogPostSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const post = await db.blogPostRecord.update({
    where: { id },
    data: {
      ...parsed.data,
      publishedAt: new Date(parsed.data.publishedAt),
      content: JSON.stringify(parsed.data.content),
    },
  });

  await logAuditEvent({
    userId: session.id,
    action: "update",
    entity: "blog_post",
    entityId: id,
  });

  return NextResponse.json(post);
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("blog:manage");
  if (error) return error;

  const { id } = await params;
  await db.blogPostRecord.delete({ where: { id } });

  await logAuditEvent({
    userId: session.id,
    action: "delete",
    entity: "blog_post",
    entityId: id,
  });

  return NextResponse.json({ success: true });
}
