import { marketingMedia } from "@/data/media/catalog";
import { getPublishedBlogPosts } from "@/lib/blog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Move } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export async function InsightsStrip({
  fabricTechEnabled = false,
}: {
  fabricTechEnabled?: boolean;
}) {
  const posts = (await getPublishedBlogPosts()).slice(0, 3);
  const fabricTechHref = fabricTechEnabled ? "/fabric-technology" : "/shop";
  const fourWayStretchHref = fabricTechEnabled ? "/fabric-technology/4-way-stretch" : "/shop";

  return (
    <section className="border-y border-border bg-section-alt py-16">
      <div className="mx-auto grid max-w-7xl gap-6 px-4 lg:grid-cols-3 lg:px-8">
        <article className="neon-border-hover overflow-hidden rounded-[2rem] border border-border bg-surface-muted">
          <div className="relative h-48">
            <Image
              src={marketingMedia.insightsFabric}
              alt="Medical scrubs — fabric technology"
              fill
              className="object-cover"
              sizes="400px"
            />
          </div>
          <div className="p-6">
            <p className="text-xs font-bold uppercase tracking-wide text-brand">Fabric Science</p>
            <h3 className="mt-2 font-display text-xl font-bold text-ink">
              The Science of the Scrub
            </h3>
            <p className="mt-2 text-sm text-muted">
              Explore layered fabric engineering and performance benefits.
            </p>
            <Link href={fabricTechHref} className="mt-4 inline-block">
              <Button variant="outline" size="sm">
                {fabricTechEnabled ? "Explore Fabric Tech" : "Shop Now"}
                <ArrowRight size={14} />
              </Button>
            </Link>
          </div>
        </article>

        <article className="neon-border-hover overflow-hidden rounded-[2rem] border border-border bg-surface-muted">
          <div className="relative h-48">
            <Image
              src={marketingMedia.insightsInstitutional}
              alt="Hospital linens and institutional apparel"
              fill
              className="object-cover"
              sizes="400px"
            />
          </div>
          <div className="p-6">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
              <Move size={20} />
            </div>
            <h3 className="font-display text-xl font-bold text-ink">Why 4-Way Stretch?</h3>
            <p className="mt-2 text-sm text-muted">
              Moves with you in every direction for ultimate comfort during long shifts.
            </p>
            <Link href={fourWayStretchHref} className="mt-4 inline-block">
              <Button variant="outline" size="sm">
                {fabricTechEnabled ? "Learn More" : "Shop Now"}
                <ArrowRight size={14} />
              </Button>
            </Link>
          </div>
        </article>

        <article className="neon-border-hover rounded-[2rem] border border-border bg-surface p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-brand">From Our Journal</p>
          <h3 className="mt-2 font-display text-xl font-bold text-ink">Latest From The Blog</h3>
          <ul className="mt-5 space-y-4">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="group flex gap-3 rounded-xl p-2 transition hover:bg-lilac/40"
                >
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg">
                    <Image src={post.image} alt="" fill className="object-cover" sizes="56px" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-ink group-hover:text-brand">
                      {post.title}
                    </p>
                    <p className="text-xs text-muted">
                      {new Date(post.publishedAt).toLocaleDateString("en-IN", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/blog"
            className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
          >
            View All Articles
            <ArrowRight size={14} />
          </Link>
        </article>
      </div>
    </section>
  );
}
