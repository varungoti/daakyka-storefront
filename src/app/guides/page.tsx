import { fabricTechPages } from "@/data/fabric-tech";
import { getSeoGuideGroups } from "@/data/seo-landing-pages";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Medical Scrubs Guides",
  description:
    "Buying guides, fabric science, and hospital uniform resources from DAAKYKA Apparels — Pan India medical apparel experts.",
};

export default function GuidesIndexPage() {
  const { commercial, intent } = getSeoGuideGroups();

  return (
    <>
      <section className="bg-lavender/30 py-16">
        <div className="mx-auto max-w-4xl px-4 text-center lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Knowledge Hub</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-ink md:text-5xl">
            Medical Apparel Guides
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted">
            Expert guides for choosing scrubs, hospital uniforms, fabric technology, and institutional
            procurement — built for healthcare professionals across India.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-6xl space-y-14 px-4 lg:px-8">
          <GuideGroup title="Shop by Category" pages={commercial} />
          <GuideGroup title="Buying & Care Guides" pages={intent} />

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
                    className="neon-border-hover block rounded-2xl border border-border bg-white p-5"
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
        </div>
      </section>
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
              className="neon-border-hover block h-full rounded-2xl border border-border bg-white p-5"
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
