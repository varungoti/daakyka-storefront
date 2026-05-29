import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { blogPostSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("blog:manage");
  if (error) return error;

  const posts = await db.blogPostRecord.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(posts);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("blog:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = blogPostSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const post = await db.blogPostRecord.create({
    data: {
      ...parsed.data,
      publishedAt: new Date(parsed.data.publishedAt),
      content: JSON.stringify(parsed.data.content),
    },
  });

  await logAuditEvent({
    userId: session.id,
    action: "create",
    entity: "blog_post",
    entityId: post.id,
  });

  return NextResponse.json(post, { status: 201 });
}
