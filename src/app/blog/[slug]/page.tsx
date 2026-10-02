import { getBlogPostBySlug, getPublishedBlogPosts } from "@/lib/blog";
import { JsonLdScript } from "@/components/seo/json-ld-script";
import { PageContentSection } from "@/components/ui/page-shell";
import { formatDateIST } from "@/lib/format/datetime";
import { baseOpenGraph, breadcrumbJsonLd, siteUrlBase, toAbsoluteUrl } from "@/lib/seo/json-ld";
import { blogPostCanonicalPath, canonicalPath } from "@/lib/seo/canonical";
import { computeReadTime } from "@/lib/seo/read-time";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  // F-051: getPublishedBlogPosts() no longer papers over a DB error with the
  // hardcoded seed posts, so a build with no database access prerenders no
  // posts instead of failing; dynamicParams (the default) renders each one on
  // first request.
  try {
    const posts = await getPublishedBlogPosts();
    return posts.map((post) => ({ slug: post.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  if (!post) {
    // release-hardening F-012: Next already tags a notFound() render
    // `noindex` on its own — `follow: true` keeps that from also fighting
    // the root layout's `index, follow`.
    return { title: "Blog", robots: { index: false, follow: true } };
  }
  // release-hardening F-155: a post that duplicates a same-slug /guides
  // page canonicalizes to the guide instead of competing with it.
  const canonical = blogPostCanonicalPath(slug);
  return {
    title: post.title,
    description: post.excerpt,
    alternates: { canonical: canonicalPath(canonical) },
    // release-hardening F-151: og:url wasn't set on any page, and a blog
    // post is an article, not a generic "website" — see the root layout's
    // doc comment on why title/description don't need repeating here.
    openGraph: {
      ...baseOpenGraph(canonical, "article"),
      images: [post.image],
      publishedTime: post.publishedAt,
      authors: [post.author],
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const readTime = computeReadTime(post.content);
  const base = siteUrlBase();

  return (
    <>
      <JsonLdScript
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt,
          image: [toAbsoluteUrl(post.image)],
          datePublished: post.publishedAt,
          // `author` is free text: "DAAKYKA Editorial" is the brand, anything
          // else an admin typed is a person.
          author: { "@type": /daakyka/i.test(post.author) ? "Organization" : "Person", name: post.author },
          publisher: { "@type": "Organization", name: "DAAKYKA Apparels", logo: `${base}/icon.svg` },
          mainEntityOfPage: `${base}${blogPostCanonicalPath(slug)}`,
        }}
      />
      <JsonLdScript
        data={breadcrumbJsonLd([
          { name: "Home", url: base },
          { name: "Journal", url: `${base}/blog` },
          { name: post.title, url: `${base}/blog/${slug}` },
        ])}
      />

      <section className="border-b border-border bg-alt-surface py-6">
        <div className="mx-auto max-w-3xl px-4 text-sm text-muted lg:px-8">
          <Link href="/" className="hover:text-brand">
            Home
          </Link>
          <span className="mx-2">›</span>
          <Link href="/blog" className="hover:text-brand">
            Journal
          </Link>
          <span className="mx-2">›</span>
          <span className="font-semibold text-ink">{post.title}</span>
        </div>
      </section>

      <PageContentSection innerClassName="max-w-3xl">
        <article>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
            {post.category}
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight text-ink md:text-5xl">
            {post.title}
          </h1>
          <p className="mt-4 text-sm text-muted">
            {post.author} · {formatDateIST(post.publishedAt)} · {readTime}
          </p>

          <div className="relative mt-8 aspect-[16/9] overflow-hidden rounded-[2rem]">
            <Image src={post.image} alt={post.title} fill className="object-cover" sizes="800px" />
          </div>

          <div className="prose prose-lg mt-10 max-w-none space-y-6 text-muted">
            {post.content.map((paragraph) => (
              <p key={paragraph} className="leading-relaxed">
                {paragraph}
              </p>
            ))}
          </div>
        </article>
      </PageContentSection>
    </>
  );
}
