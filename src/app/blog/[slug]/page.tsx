import { getBlogPostBySlug, getPublishedBlogPosts } from "@/lib/blog";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const posts = await getPublishedBlogPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);
  if (!post) return { title: "Blog" };
  return {
    title: post.title,
    description: post.excerpt,
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug);

  if (!post) {
    notFound();
  }

  return (
    <>
      <section className="border-b border-border bg-lavender/20 py-6">
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

      <article className="py-16">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
            {post.category}
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight text-ink md:text-5xl">
            {post.title}
          </h1>
          <p className="mt-4 text-sm text-muted">
            {post.author} · {new Date(post.publishedAt).toLocaleDateString("en-IN")} ·{" "}
            {post.readTime}
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
        </div>
      </article>
    </>
  );
}
