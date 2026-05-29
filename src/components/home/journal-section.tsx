import { getPublishedBlogPosts } from "@/lib/blog";
import { SectionHeading } from "@/components/ui/section-heading";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export async function JournalSection() {
  const posts = (await getPublishedBlogPosts()).slice(0, 3);

  return (
    <section className="bg-lavender/20 py-20 md:py-24">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <SectionHeading
            eyebrow="From Our Journal"
            title="Style, Fit & Fabric Insights"
            description="Guides and stories for healthcare professionals who care about what they wear."
          />
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
          >
            View All Articles
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="neon-border-hover overflow-hidden rounded-[2rem] border border-border bg-white"
            >
              <div className="relative aspect-[16/10]">
                <Image src={post.image} alt={post.title} fill className="object-cover" sizes="400px" />
              </div>
              <div className="space-y-2 p-5">
                <p className="text-xs font-bold uppercase tracking-wide text-brand">
                  {post.category}
                </p>
                <h3 className="font-display text-lg font-bold text-ink">{post.title}</h3>
                <p className="line-clamp-2 text-sm text-muted">{post.excerpt}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
