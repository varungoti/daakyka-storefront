import { SectionHeading } from "@/components/ui/section-heading";
import { fitTips, menSizeGuide, womenSizeGuide } from "@/data/size-guide";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Size Guide",
  description:
    "Find your perfect fit with DAAKYKA size charts, fit tips, and measurement guidance for medical scrubs.",
};

export default function SizeGuidePage() {
  return (
    <>
      <section className="bg-lavender/30 py-16">
        <div className="mx-auto max-w-7xl px-4 text-center lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Fit Confidence</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-ink md:text-5xl">
            Size Guide
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted">
            Measure once, choose confidently. Use our charts to find the best size for tops and
            bottoms.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-7xl space-y-16 px-4 lg:px-8">
          <SizeTable title="Women's Size Chart" rows={womenSizeGuide} />
          <SizeTable title="Men's Size Chart" rows={menSizeGuide} />

          <div>
            <SectionHeading
              eyebrow="Fit Tips"
              title="How to Choose Your Size"
              description="Practical guidance for getting the most comfortable, professional fit."
            />
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              {fitTips.map((tip) => (
                <article
                  key={tip.title}
                  className="rounded-3xl border border-border bg-white p-6"
                >
                  <h3 className="font-display text-lg font-bold text-ink">{tip.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{tip.description}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-lavender/30 p-8 text-center">
            <p className="font-display text-2xl font-bold text-ink">Still unsure?</p>
            <p className="mt-2 text-muted">
              Build your set with our Mix & Match tool or contact support for team sizing help.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <Link
                href="/mix-and-match"
                className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white"
              >
                Try Mix & Match
              </Link>
              <Link
                href="/contact"
                className="rounded-full border border-border bg-white px-6 py-3 text-sm font-semibold text-ink"
              >
                Contact Support
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function SizeTable({
  title,
  rows,
}: {
  title: string;
  rows: typeof womenSizeGuide;
}) {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-border bg-white">
      <div className="border-b border-border px-6 py-5">
        <h2 className="font-display text-2xl font-bold text-ink">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-6 py-4">Size</th>
              <th className="px-6 py-4">Chest</th>
              <th className="px-6 py-4">Waist</th>
              <th className="px-6 py-4">Hip</th>
              <th className="px-6 py-4">Inseam</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.size} className="border-t border-border">
                <td className="px-6 py-4 font-semibold text-brand">{row.size}</td>
                <td className="px-6 py-4 text-muted">{row.chest}</td>
                <td className="px-6 py-4 text-muted">{row.waist}</td>
                <td className="px-6 py-4 text-muted">{row.hip}</td>
                <td className="px-6 py-4 text-muted">{row.inseam}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
