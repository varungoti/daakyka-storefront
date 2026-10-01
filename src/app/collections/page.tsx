import { collectionPages } from "@/data/seo-landing-pages";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { canonicalPath } from "@/lib/seo/canonical";
import { baseOpenGraph } from "@/lib/seo/json-ld";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

// release-hardening F-147/F-151: this used to be only {title, description},
// so /collections inherited the root layout's canonical (the homepage) and
// its og:title/og:url, despite being listed as its own URL in sitemap.ts.
export const metadata: Metadata = {
  title: "Collections",
  description: "Browse DAAKYKA collections, starting with our current featured picks.",
  alternates: { canonical: canonicalPath("/collections") },
  openGraph: baseOpenGraph("/collections"),
};

export default function CollectionsPage() {
  return (
    <>
      <PageHeroBand innerClassName="text-center">
        <SectionHeading
          eyebrow="Browse"
          title="Shop Collections"
          description="Curated groups to help you find the right products faster."
          align="center"
        />
      </PageHeroBand>

      <PageContentSection>
        <div className="grid gap-6 md:grid-cols-2">
          {collectionPages.map((collection) => (
            <Link
              key={collection.handle}
              href={`/collections/${collection.handle}`}
              className="hover:border-brand hover:shadow-sm transition-colors rounded-[2rem] border border-border bg-surface-elevated p-8 transition"
            >
              <h2 className="font-display text-2xl font-bold text-ink">{collection.title}</h2>
              <p className="mt-3 text-sm text-muted">{collection.description}</p>
              <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-brand">
                Explore collection
                <ArrowRight size={16} />
              </p>
            </Link>
          ))}
        </div>
      </PageContentSection>
    </>
  );
}
