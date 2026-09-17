import { DeleteButton } from "@/components/admin/delete-button";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getStaticSeoAudits, summarizeSeoAudits } from "@/lib/seo/audit";
import {
  breadcrumbJsonLd,
  organizationJsonLd,
  productJsonLd,
  websiteJsonLd,
} from "@/lib/seo/json-ld";
import { listSeoRecordsForAdmin } from "@/lib/seo/records";
import {
  summarizeSchemaValidation,
  validateJsonLdObject,
} from "@/lib/seo/schema-validation";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminSeoPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "seo:manage")) {
    redirect("/admin/dashboard");
  }

  const staticAudits = await getStaticSeoAudits();
  const blogPosts = await db.blogPostRecord.findMany({
    where: { status: "PUBLISHED" },
    select: { slug: true, title: true, excerpt: true },
  });

  const blogAudits = blogPosts.map((post) => ({
    path: `/blog/${post.slug}`,
    title: post.title,
    metaDescription: post.excerpt,
    h1: post.title,
    status: post.excerpt.length < 50 ? ("needs_meta" as const) : ("ok" as const),
    issues: post.excerpt.length < 50 ? ["Excerpt may be too short for meta"] : [],
  }));

  const pages = [...staticAudits, ...blogAudits];
  const summary = summarizeSeoAudits(pages);
  const dbRecords = await listSeoRecordsForAdmin();

  const schemaChecks = [
    { label: "Organization", data: organizationJsonLd() },
    { label: "WebSite", data: websiteJsonLd() },
    {
      label: "Sample Product",
      data: productJsonLd({
        id: "schema-sample",
        handle: "sample-scrub",
        name: "Sample Scrub Top",
        description: "Schema validation sample product",
        image: "https://daakyka.com/favicon.ico",
        price: 1999,
        available: true,
        rating: 4.7,
        reviewCount: 50,
      }),
    },
    {
      label: "Sample Breadcrumb",
      data: breadcrumbJsonLd([
        { name: "Home", url: "https://daakyka.com" },
        { name: "Guides", url: "https://daakyka.com/guides" },
      ]),
    },
    {
      label: "Sample FAQ",
      data: {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Sample question?",
            acceptedAnswer: { "@type": "Answer", text: "Sample answer." },
          },
        ],
      },
    },
  ].map((item) => ({
    label: item.label,
    ...validateJsonLdObject(item.data as Record<string, unknown>),
  }));

  const schemaSummary = summarizeSchemaValidation(schemaChecks);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">SEO Manager</h1>
        <p className="text-muted">Page metadata audit and structured data validation.</p>
      </div>

      <section className="rounded-3xl border border-border bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">Schema Validation</h2>
        <p className="mt-1 text-sm text-muted">
          JSON-LD fixtures for Organization, WebSite, Product, Breadcrumb, and FAQ schemas.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <StatCard label="Schemas Checked" value={String(schemaSummary.total)} />
          <StatCard label="Valid" value={String(schemaSummary.valid)} />
          <StatCard label="Issues" value={String(schemaSummary.invalid)} />
        </div>
        <ul className="mt-6 space-y-3">
          {schemaChecks.map((check) => (
            <li
              key={check.label}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 px-4 py-3 text-sm"
            >
              <span className="font-semibold text-ink">{check.label}</span>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${
                  check.valid ? "bg-trust/15 text-trust" : "bg-amber-100 text-amber-800"
                }`}
              >
                {check.valid ? "valid" : "review"}
              </span>
              {!check.valid && (
                <p className="w-full text-xs text-muted">{check.issues.join("; ")}</p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Pages Audited" value={String(summary.total)} />
        <StatCard label="Healthy" value={String(summary.ok)} />
        <StatCard label="Needs Meta" value={String(summary.needsMeta)} />
        <StatCard label="DB Overrides" value={String(dbRecords.length)} />
      </div>

      <section className="overflow-x-auto rounded-3xl border border-border bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Path</th>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Meta</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Issues</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.path} className="border-b border-border/70 align-top">
                <td className="px-4 py-3">
                  <Link href={page.path} className="font-semibold text-brand hover:underline">
                    {page.path}
                  </Link>
                </td>
                <td className="max-w-xs px-4 py-3 text-ink">{page.title}</td>
                <td className="max-w-xs px-4 py-3 text-muted line-clamp-2">{page.metaDescription}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={page.status} />
                </td>
                <td className="max-w-xs px-4 py-3 text-xs text-muted">
                  {page.issues.length ? page.issues.join("; ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-ink">SEO Overrides</h2>
            <p className="text-sm text-muted">
              Editable per-page title/meta description overrides. Home (/) and Shop (/shop) are
              read live by the storefront&apos;s page metadata.
            </p>
          </div>
          <Link
            href="/admin/seo/new"
            className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
          >
            New Override
          </Link>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-border bg-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Path</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {dbRecords.map((record) => (
                <tr key={record.id} className="border-b border-border/70 align-top">
                  <td className="px-4 py-3 font-semibold text-ink">{record.path}</td>
                  <td className="max-w-xs px-4 py-3 text-ink">{record.title}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={record.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {record.updatedAt.toLocaleDateString("en-IN")}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/admin/seo/${record.id}`}
                        className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40"
                      >
                        Edit
                      </Link>
                      <DeleteButton
                        href={`/api/admin/seo/${record.id}`}
                        confirmMessage={`Delete the SEO override for ${record.path}?`}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {dbRecords.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No overrides yet — add one to control a page&apos;s title and meta description.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-brand">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles =
    status === "ok"
      ? "bg-trust/15 text-trust"
      : status === "missing_h1"
        ? "bg-red-100 text-red-700"
        : "bg-amber-100 text-amber-800";
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${styles}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
}
