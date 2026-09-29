import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { revalidateBlogCache } from "@/lib/blog";
import { db } from "@/lib/db";
import { parseIstDateOnly } from "@/lib/format/datetime";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { blogPostSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("blog:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = blogPostSchema.safeParse(bodyResult.data);

  if (!parsed.success) {
    // F-216: see the identical fix in ../route.ts's POST handler.
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const post = await db.blogPostRecord.update({
      where: { id },
      data: {
        ...parsed.data,
        // F-331: see the sibling POST route's identical comment.
        publishedAt: parseIstDateOnly(parsed.data.publishedAt) ?? new Date(parsed.data.publishedAt),
        content: JSON.stringify(parsed.data.content),
      },
    });

    await logAuditEvent({
      userId: session.id,
      action: "update",
      entity: "blog_post",
      entityId: id,
    });

    revalidateBlogCache();

    return NextResponse.json(post);
  } catch (err) {
    // F-216: PUT on an unknown id (P2025) or onto a slug already used by a
    // different post (P2002) both crashed with an unhandled 500.
    if (isRecordNotFound(err)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "A post with this slug already exists", issues: [{ path: ["slug"], message: "A post with this slug already exists" }] },
        { status: 409 },
      );
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("blog:manage");
  if (error) return error;

  const { id } = await params;
  try {
    await db.blogPostRecord.delete({ where: { id } });
  } catch (err) {
    // F-216: DELETE on an unknown/already-deleted id crashed with an
    // unhandled 500 instead of a clean 404.
    if (isRecordNotFound(err)) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }
    throw err;
  }

  await logAuditEvent({
    userId: session.id,
    action: "delete",
    entity: "blog_post",
    entityId: id,
  });

  revalidateBlogCache();

  return NextResponse.json({ success: true });
}
