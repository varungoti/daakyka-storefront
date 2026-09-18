import { getPublishedBlogPosts } from "@/lib/blog";
import { SectionHeading } from "@/components/ui/section-heading";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { canonicalPath } from "@/lib/seo/canonical";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Journal",
  description: "Style, fit, and fabric insights from the DAAKYKA editorial team.",
  alternates: { canonical: canonicalPath("/blog") },
};

export default async function BlogPage() {
  const blogPosts = await getPublishedBlogPosts();

  return (
    <>
      <PageHeroBand innerClassName="max-w-2xl text-center">
        <SectionHeading
          eyebrow="From Our Journal"
          title="Style, Fit & Fabric Insights"
          description="Guides and stories for healthcare professionals who care about what they wear."
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>

      <PageContentSection>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {blogPosts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="hover:border-brand hover:shadow-sm transition-colors overflow-hidden rounded-[2rem] border border-border bg-surface-elevated"
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
      </PageContentSection>
    </>
  );
}
