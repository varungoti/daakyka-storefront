import { getPublishedBlogPosts } from "@/lib/blog";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Journal",
  description: "Style, fit, and fabric insights from the DAAKYKA editorial team.",
};

export default async function BlogPage() {
  const blogPosts = await getPublishedBlogPosts();

  return (
    <>
      <section className="bg-lavender/30 py-16">
        <div className="mx-auto max-w-7xl px-4 text-center lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">From Our Journal</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-ink md:text-5xl">
            Style, Fit & Fabric Insights
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted">
            Guides and stories for healthcare professionals who care about what they wear.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 md:grid-cols-2 lg:grid-cols-3 lg:px-8">
          {blogPosts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="neon-border-hover overflow-hidden rounded-[2rem] border border-border bg-white"
            >
              <div className="relative aspect-[16/10]">
                <Image src={post.image} alt={post.title} fill className="object-cover" sizes="400px" />
              </div>
              <div className="space-y-3 p-6">
                <p className="text-xs font-bold uppercase tracking-wide text-brand">
                  {post.category}
                </p>
                <h2 className="font-display text-xl font-bold text-ink">{post.title}</h2>
                <p className="text-sm leading-relaxed text-muted">{post.excerpt}</p>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-brand">
                  Read Article
                  <ArrowRight size={16} />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
