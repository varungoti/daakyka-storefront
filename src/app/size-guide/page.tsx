import { SectionHeading } from "@/components/ui/section-heading";
import { fitTips } from "@/data/size-guide";
import { getSizeChartsForDisplay, type SizeChartForDisplay } from "@/lib/catalog/size-charts";
import { isPageEnabled } from "@/lib/settings";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Size Guide",
  description:
    "Find your perfect fit with DAAKYKA size charts, fit tips, and measurement guidance for hospital, school, and kids' apparel.",
};

const SECTION_LABELS: Record<string, string> = {
  HOSPITAL: "For Hospitals",
  SCHOOL: "School Uniforms",
  KIDS: "Kids Wear",
  GENERAL: "General",
};

export default async function SizeGuidePage() {
  const [mixMatchEnabled, sectionGroups] = await Promise.all([
    isPageEnabled("mixMatch"),
    getSizeChartsForDisplay(),
  ]);

  return (
    <>
      <section className="border-b border-border bg-alt-surface py-16 md:py-20">
        <div className="mx-auto max-w-[1320px] px-4 text-center lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">Fit Confidence</p>
          <h1 className="mt-3 font-display text-4xl font-bold text-ink md:text-5xl">
            Size Guide
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted">
            Measure once, choose confidently. Use our charts to find the best size across our
            hospital, school, and kids&apos; ranges.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-[1320px] space-y-16 px-4 lg:px-8">
          {sectionGroups.length > 0 ? (
            sectionGroups.map((group) => (
              <div key={group.section} className="space-y-8">
                <SectionHeading
                  eyebrow={SECTION_LABELS[group.section] ?? group.section}
                  title={`${SECTION_LABELS[group.section] ?? group.section} Size Charts`}
                />
                {group.charts.map((chart) => (
                  <SizeTable key={chart.id} chart={chart} />
                ))}
              </div>
            ))
          ) : (
            <div className="rounded-[2rem] border border-dashed border-border bg-surface-muted p-8 text-center text-muted">
              Size charts are being finalized — check back soon, or contact support for measurements.
            </div>
          )}

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
                  className="rounded-3xl border border-border bg-surface-elevated p-6"
                >
                  <h3 className="font-display text-lg font-bold text-ink">{tip.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{tip.description}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-surface-muted p-8 text-center">
            <p className="font-display text-2xl font-bold text-ink">Still unsure?</p>
            <p className="mt-2 text-muted">
              {mixMatchEnabled
                ? "Build your set with our Mix & Match tool or contact support for team sizing help."
                : "Contact support for team sizing help, or browse the shop for your fit."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              {mixMatchEnabled ? (
                <Link
                  href="/mix-and-match"
                  className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white"
                >
                  Try Mix & Match
                </Link>
              ) : (
                <Link
                  href="/shop"
                  className="rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white"
                >
                  Shop Now
                </Link>
              )}
              <Link
                href="/contact"
                className="rounded-full border border-border bg-surface-elevated px-6 py-3 text-sm font-semibold text-ink"
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

function SizeTable({ chart }: { chart: SizeChartForDisplay }) {
  return (
    <div className="overflow-hidden rounded-[2rem] border border-border bg-surface-elevated">
      <div className="border-b border-border px-6 py-5">
        <h3 className="font-display text-xl font-bold text-ink">{chart.name}</h3>
        <p className="text-xs uppercase tracking-wide text-muted">Measurements in {chart.unit === "IN" ? "inches" : "centimeters"}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
            <tr>
              {chart.columns.map((column) => (
                <th key={column} className="px-6 py-4">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chart.rows.map((row, index) => (
              <tr key={index} className="border-t border-border">
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={cellIndex === 0 ? "px-6 py-4 font-semibold text-brand" : "px-6 py-4 text-muted"}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chart.notes && <p className="border-t border-border px-6 py-4 text-xs text-muted">{chart.notes}</p>}
    </div>
  );
}
