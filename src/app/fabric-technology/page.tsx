import { SectionHeading } from "@/components/ui/section-heading";
import { fabricTechPages } from "@/data/fabric-tech";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fabric Technology",
  description: "Explore DAAKYKA fabric science and performance technology.",
};

export default function FabricTechnologyPage() {
  return (
    <>
      <section className="bg-lavender/30 py-16">
        <div className="mx-auto max-w-7xl px-4 text-center lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">
            Performance Engineering
          </p>
          <h1 className="mt-3 font-display text-4xl font-bold text-ink md:text-5xl">
            Fabric Technology Hub
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted">
            Deep dives into every fabric innovation powering DAAKYKA scrubs.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 md:grid-cols-2 lg:grid-cols-3 lg:px-8">
          {fabricTechPages.map((page) => (
            <Link
              key={page.slug}
              href={`/fabric-technology/${page.slug}`}
              className="neon-border-hover rounded-3xl border border-border bg-white p-8"
            >
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-brand">
                {page.eyebrow}
              </p>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink">
                {page.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {page.description}
              </p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand">
                Learn More
                <ArrowRight size={16} />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
