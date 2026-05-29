import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminBlogPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "blog:manage")) {
    redirect("/admin/dashboard");
  }

  const posts = await db.blogPostRecord.findMany({
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Blog CMS</h1>
          <p className="text-muted">Manage journal articles for the storefront.</p>
        </div>
        <Link
          href="/admin/blog/new"
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90"
        >
          New Article
        </Link>
      </div>

      <div className="space-y-3">
        {posts.map((post) => (
          <Link
            key={post.id}
            href={`/admin/blog/${post.id}`}
            className="block rounded-2xl border border-border bg-white p-5 transition hover:border-brand/40"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-display text-lg font-bold text-ink">{post.title}</p>
                <p className="text-sm text-muted">
                  {post.category} · {post.status} · {post.slug}
                </p>
              </div>
              <p className="text-xs text-muted">
                {post.updatedAt.toLocaleDateString("en-IN")}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
