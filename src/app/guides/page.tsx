import { fabricTechPages } from "@/data/fabric-tech";
import { getSeoGuideGroups } from "@/data/seo-landing-pages";
import { canonicalPath } from "@/lib/seo/canonical";
import { isPageEnabled } from "@/lib/settings";
import { SectionHeading } from "@/components/ui/section-heading";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Medical Scrubs Guides",
  description:
    "Buying guides, fabric science, and hospital uniform resources from DAAKYKA Apparels — Pan India medical apparel experts.",
  alternates: { canonical: canonicalPath("/guides") },
};

export default async function GuidesIndexPage() {
  const { commercial, intent } = getSeoGuideGroups();
  const fabricTechEnabled = await isPageEnabled("fabricTech");

  return (
    <>
      <PageHeroBand innerClassName="max-w-4xl text-center">
        <SectionHeading
          eyebrow="Knowledge Hub"
          title="Medical Apparel Guides"
          description="Expert guides for choosing scrubs, hospital uniforms, fabric technology, and institutional procurement — built for healthcare professionals across India."
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>

      <PageContentSection innerClassName="max-w-6xl space-y-14">
        <GuideGroup title="Shop by Category" pages={commercial} />
        <GuideGroup title="Buying & Care Guides" pages={intent} />

        {fabricTechEnabled ? (
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Fabric Technology</h2>
            <p className="mt-2 text-sm text-muted">
              Deep dives into the performance fabrics powering DAAKYKA scrubs.
            </p>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fabricTechPages.map((page) => (
                <li key={page.slug}>
                  <Link
                    href={`/fabric-technology/${page.slug}`}
                    className="hover:border-brand hover:shadow-sm transition-colors block rounded-2xl border border-border bg-surface p-5"
                  >
                    <p className="text-xs font-bold uppercase tracking-wide text-brand">{page.eyebrow}</p>
                    <p className="mt-2 font-display text-lg font-bold text-ink">{page.title}</p>
                    <p className="mt-2 line-clamp-2 text-sm text-muted">{page.description}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                      Read guide
                      <ArrowRight size={14} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <Link
              href="/fabric-technology"
              className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand hover:underline"
            >
              View Fabric Technology Hub
              <ArrowRight size={14} />
            </Link>
          </div>
        ) : null}
      </PageContentSection>
    </>
  );
}

function GuideGroup({
  title,
  pages,
}: {
  title: string;
  pages: { slug: string; title: string; intro: string }[];
}) {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {pages.map((page) => (
          <li key={page.slug}>
            <Link
              href={`/guides/${page.slug}`}
              className="hover:border-brand hover:shadow-sm transition-colors block h-full rounded-2xl border border-border bg-surface p-5"
            >
              <p className="font-display text-lg font-bold text-ink">{page.title}</p>
              <p className="mt-2 line-clamp-3 text-sm text-muted">{page.intro}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                Read guide
                <ArrowRight size={14} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
