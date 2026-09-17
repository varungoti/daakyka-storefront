import { collectionPages } from "@/data/seo-landing-pages";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Collections",
  description: "Browse DAAKYKA collections — best sellers, stretch, hospital teams, and bespoke.",
};

export default function CollectionsPage() {
  return (
    <>
      <PageHeroBand innerClassName="text-center">
        <SectionHeading
          eyebrow="Browse"
          title="Shop Collections"
          description="Curated groups to help you find the right scrubs faster."
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
