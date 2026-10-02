import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
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
    // F-216: `issues` (not `details: flatten()`) matches every other admin
    // form's error shape (see e.g. discounts, hero-slides) and is what
    // formatApiError()/the editor's field-level errors read.
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
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
      // F-288: this row used to carry no metadata at all.
      metadata: { title: post.title, slug: post.slug, status: post.status },
    });

    revalidateBlogCache();

    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    // F-216: a duplicate slug (BlogPostRecord.slug is @unique) crashed this
    // with an unhandled 500 instead of a clear "already exists" — the
    // owner's actual UI symptom was "Save failed. Check all fields."
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "A post with this slug already exists", issues: [{ path: ["slug"], message: "A post with this slug already exists" }] },
        { status: 409 },
      );
    }
    throw err;
  }
}
