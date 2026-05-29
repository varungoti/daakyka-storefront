import { collectionPages } from "@/data/seo-landing-pages";
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
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <SectionHeading
          eyebrow="Browse"
          title="Shop Collections"
          description="Curated groups to help you find the right scrubs faster."
          align="center"
          className="mb-12"
        />
        <div className="grid gap-6 md:grid-cols-2">
          {collectionPages.map((collection) => (
            <Link
              key={collection.handle}
              href={`/collections/${collection.handle}`}
              className="neon-border-hover rounded-[2rem] border border-border bg-white p-8 transition"
            >
              <h2 className="font-display text-2xl font-bold text-ink">{collection.title}</h2>
              <p className="mt-3 text-sm text-muted">{collection.description}</p>
              <p className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                View collection
                <ArrowRight size={14} />
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
