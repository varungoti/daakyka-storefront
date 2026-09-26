import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { revalidateBlogCache } from "@/lib/blog";
import { db } from "@/lib/db";
import { parseIstDateOnly } from "@/lib/format/datetime";
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
      // F-331: the editor sends a plain "YYYY-MM-DD" (from an
      // <input type="date">, always the store's own IST calendar day) —
      // `new Date(value)` reads that as *UTC* midnight (05:30 IST), which
      // is what let 00:00-05:29 IST posts render as the previous day.
      // parseIstDateOnly reads it as IST midnight instead; the `new Date`
      // fallback only matters for a malformed value that shouldn't reach
      // here past blogPostSchema, but keeps prior behaviour for one.
      publishedAt: parseIstDateOnly(parsed.data.publishedAt) ?? new Date(parsed.data.publishedAt),
      content: JSON.stringify(parsed.data.content),
    },
  });

  await logAuditEvent({
    userId: session.id,
    action: "create",
    entity: "blog_post",
    entityId: post.id,
  });

  revalidateBlogCache();

  return NextResponse.json(post, { status: 201 });
}
