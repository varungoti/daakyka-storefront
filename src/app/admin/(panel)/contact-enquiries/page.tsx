import { ContactEnquiryStatusSelect } from "@/components/admin/contact-enquiry-status-select";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateIST } from "@/lib/format/datetime";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

// F-049: `page` is a user-controlled URL query param — Zod per this
// repo's "Zod for any new input" convention. `.catch(1)` rather than
// throwing: an out-of-range or garbage page number is cosmetic here, not
// a security concern, so it just falls back to page 1. Mirrors
// src/app/account/(dashboard)/orders/page.tsx's identical pattern.
const pageParamSchema = z.coerce.number().int().min(1).max(100_000).catch(1);
const PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

export default async function AdminContactEnquiriesPage({ searchParams }: PageProps) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "bulk-orders:manage")) {
    redirect("/admin/dashboard");
  }

  const { page: rawPage } = await searchParams;
  const page = pageParamSchema.parse(rawPage);

  // F-049: this used to load every row with no `take` at all (274+ rows
  // and growing, unpaginated).
  const [enquiries, total] = await Promise.all([
    db.contactEnquiry.findMany({
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.contactEnquiry.count(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Contact Enquiries</h1>
        <p className="text-muted">General, institutional, and support messages from the contact form.</p>
      </div>

      {/* F-049: below `md`, the table's Message column ran off a 375px
          viewport with no way to reach it short of scrolling sideways —
          this stacked-card layout replaces the table entirely on small
          screens instead of trying to squeeze it in. */}
      <div className="space-y-3 md:hidden">
        {enquiries.map((enquiry) => (
          <div key={enquiry.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink">{enquiry.name}</p>
                <a href={`mailto:${enquiry.email}`} className="block truncate text-sm text-brand hover:underline">
                  {enquiry.email}
                </a>
                {enquiry.phone && (
                  <a href={`tel:${enquiry.phone}`} className="block text-sm text-brand hover:underline">
                    {enquiry.phone}
                  </a>
                )}
                {enquiry.organization && <p className="mt-1 text-xs text-muted">{enquiry.organization}</p>}
              </div>
              <span className="shrink-0 rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-medium">
                {enquiry.type.replace("_", " ")}
              </span>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm text-muted">{enquiry.message}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted">{formatDateIST(enquiry.createdAt)}</p>
              <ContactEnquiryStatusSelect enquiryId={enquiry.id} currentStatus={enquiry.status} />
            </div>
          </div>
        ))}
        {enquiries.length === 0 && (
          <p className="rounded-2xl border border-border bg-surface p-8 text-center text-muted">
            No contact enquiries yet.
          </p>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-3xl border border-border bg-surface md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map((enquiry) => (
              <tr key={enquiry.id} className="border-b border-border/70 align-top">
                <td className="px-4 py-4">
                  <p className="font-semibold text-ink">{enquiry.name}</p>
                  <a href={`mailto:${enquiry.email}`} className="text-brand hover:underline">
                    {enquiry.email}
                  </a>
                  {enquiry.phone && (
                    <a href={`tel:${enquiry.phone}`} className="block text-muted hover:text-brand hover:underline">
                      {enquiry.phone}
                    </a>
                  )}
                  {enquiry.organization && (
                    <p className="mt-1 text-xs text-brand">{enquiry.organization}</p>
                  )}
                </td>
                <td className="px-4 py-4">
                  <span className="rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-medium">
                    {enquiry.type.replace("_", " ")}
                  </span>
                </td>
                <td className="max-w-xs whitespace-pre-wrap break-words px-4 py-4 text-muted">{enquiry.message}</td>
                <td className="px-4 py-4">
                  <ContactEnquiryStatusSelect enquiryId={enquiry.id} currentStatus={enquiry.status} />
                </td>
                <td className="px-4 py-4 text-muted">{formatDateIST(enquiry.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {enquiries.length === 0 && (
          <p className="p-8 text-center text-muted">No contact enquiries yet.</p>
        )}
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center justify-between pt-2 text-sm" aria-label="Contact enquiry pagination">
          {page > 1 ? (
            <Link href={`/admin/contact-enquiries?page=${page - 1}`} className="font-semibold text-brand hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {page} of {totalPages} · {total} total
          </span>
          {page < totalPages ? (
            <Link href={`/admin/contact-enquiries?page=${page + 1}`} className="font-semibold text-brand hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
