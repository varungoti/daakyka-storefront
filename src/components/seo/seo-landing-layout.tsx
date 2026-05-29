import { ProductCard } from "@/components/ui/product-card";
import { Button } from "@/components/ui/button";
import { JsonLdScript } from "@/components/seo/json-ld-script";
import { breadcrumbJsonLd, siteUrlBase } from "@/lib/seo/json-ld";
import {
  resolveSeoRelated,
  type SeoLandingPageConfig,
} from "@/data/seo-landing-pages";
import { trustItems } from "@/data/navigation";
import { getBlogPost } from "@/data/blog";
import type { Product } from "@/lib/types";
import { ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";

export function SeoLandingLayout({
  page,
  products = [],
}: {
  page: SeoLandingPageConfig;
  products?: Product[];
}) {
  const base = siteUrlBase();
  const guideUrl = `${base}/guides/${page.slug}`;
  const related = resolveSeoRelated(page);
  const relatedPosts = related.blogSlugs
    .map((slug) => getBlogPost(slug))
    .filter((post): post is NonNullable<ReturnType<typeof getBlogPost>> => Boolean(post));

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: { "@type": "Answer", text: faq.answer },
    })),
  };

  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: base },
    { name: "Guides", url: `${base}/guides` },
    { name: page.title, url: guideUrl },
  ]);

  return (
    <>
      <JsonLdScript data={faqJsonLd} />
      <JsonLdScript data={breadcrumbs} />

      <nav className="border-b border-border bg-white py-3 text-sm text-muted">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-1 px-4 lg:px-8">
          <Link href="/" className="hover:text-brand">
            Home
          </Link>
          <ChevronRight size={14} />
          <Link href="/guides" className="hover:text-brand">
            Guides
          </Link>
          <ChevronRight size={14} />
          <span className="text-ink">{page.title}</span>
        </div>
      </nav>

      <section className="bg-gradient-to-b from-lavender/40 to-white py-16 md:py-20">
        <div className="mx-auto max-w-4xl px-4 text-center lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">DAAKYKA Guides</p>
          <h1 className="mt-3 font-display text-4xl font-extrabold text-ink md:text-5xl">{page.h1}</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted">{page.intro}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={page.shopHref}>
              <Button size="lg">
                {page.shopLabel}
                <ArrowRight size={18} />
              </Button>
            </Link>
            {page.secondaryHref && page.secondaryLabel && (
              <Link href={page.secondaryHref}>
                <Button variant="outline" size="lg">
                  {page.secondaryLabel}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-4xl px-4 lg:px-8">
          <h2 className="font-display text-2xl font-bold text-ink">Why DAAKYKA</h2>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {page.bullets.map((bullet) => (
              <li
                key={bullet}
                className="flex items-start gap-3 rounded-2xl border border-border bg-white p-4 text-sm text-muted"
              >
                <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-trust" />
                {bullet}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {page.buyingGuide && page.buyingGuide.length > 0 && (
        <section className="border-y border-border bg-lavender/20 py-16">
          <div className="mx-auto max-w-4xl px-4 lg:px-8">
            <h2 className="font-display text-2xl font-bold text-ink">Buying Guide</h2>
            <ol className="mt-6 space-y-4">
              {page.buyingGuide.map((step, index) => (
                <li key={step} className="flex gap-4 text-sm leading-relaxed text-muted">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-bold text-brand">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {products.length > 0 && (
        <section className="py-16">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-display text-2xl font-bold text-ink">Shop Recommended Scrubs</h2>
              <Link href="/shop" className="text-sm font-semibold text-brand hover:underline">
                View all products
              </Link>
            </div>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {products.slice(0, 4).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-border bg-white py-12">
        <div className="mx-auto grid max-w-6xl gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-8">
          {trustItems.slice(0, 4).map((item) => (
            <div key={item.title} className="rounded-2xl border border-border bg-lavender/20 p-4 text-center">
              <p className="font-semibold text-ink">{item.title}</p>
              <p className="mt-1 text-xs text-muted">{item.description}</p>
            </div>
          ))}
        </div>
      </section>

      {(related.guides.length > 0 || related.collections.length > 0 || relatedPosts.length > 0) && (
        <section className="border-t border-border py-16">
          <div className="mx-auto max-w-6xl px-4 lg:px-8">
            <h2 className="font-display text-2xl font-bold text-ink">Related Resources</h2>
            <div className="mt-8 grid gap-8 md:grid-cols-3">
              {related.guides.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-brand">Guides</h3>
                  <ul className="mt-4 space-y-2">
                    {related.guides.map((guide) => (
                      <li key={guide.slug}>
                        <Link
                          href={`/guides/${guide.slug}`}
                          className="text-sm font-medium text-ink hover:text-brand"
                        >
                          {guide.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {related.collections.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-brand">Collections</h3>
                  <ul className="mt-4 space-y-2">
                    {related.collections.map((collection) => (
                      <li key={collection.handle}>
                        <Link
                          href={`/collections/${collection.handle}`}
                          className="text-sm font-medium text-ink hover:text-brand"
                        >
                          {collection.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {relatedPosts.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-brand">From the Journal</h3>
                  <ul className="mt-4 space-y-2">
                    {relatedPosts.map((post) => (
                      <li key={post.slug}>
                        <Link
                          href={`/blog/${post.slug}`}
                          className="text-sm font-medium text-ink hover:text-brand"
                        >
                          {post.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="border-t border-border bg-lavender/30 py-16">
        <div className="mx-auto max-w-3xl px-4 lg:px-8">
          <h2 className="font-display text-2xl font-bold text-ink">Frequently Asked Questions</h2>
          <dl className="mt-8 space-y-6">
            {page.faqs.map((faq) => (
              <div key={faq.question}>
                <dt className="font-semibold text-ink">{faq.question}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="py-12 text-center">
        <Link href={page.shopHref}>
          <Button size="lg">
            {page.shopLabel}
            <ArrowRight size={18} />
          </Button>
        </Link>
      </section>
    </>
  );
}
