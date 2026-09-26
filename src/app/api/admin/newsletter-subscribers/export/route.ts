import { stringifyCsv } from "@/lib/catalog/csv";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { logAuditEvent } from "@/lib/auth/audit";
import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * F-153: CSV export for the newsletter subscriber list — see the paired
 * page at src/app/admin/(panel)/engagement/subscribers/page.tsx. Gated by
 * the same `engagement:manage` permission as that page and the rest of
 * the Engagement Hub.
 *
 * `confirmToken`/`unsubscribeToken` are live secrets (a valid
 * confirm/unsubscribe link) and are never selected here, let alone
 * exported.
 */

const STATUS_WHERE: Record<string, Prisma.NewsletterSubscriberWhereInput> = {
  active: { consentGiven: true, confirmedAt: { not: null }, unsubscribedAt: null },
  pending: { confirmedAt: null, unsubscribedAt: null },
  unsubscribed: { unsubscribedAt: { not: null } },
};

// Formula-injection guard: a cell opening with =, +, -, @ (or a
// tab/CR) is a live formula in Excel/Sheets once the CSV is opened.
// Neither `email` nor `source` is otherwise restricted from starting
// with one of these — email in particular is fully attacker-controlled
// (the public newsletter-signup form) — so every exported cell is
// prefixed with a leading `'` when it starts with one of them, same as
// a manually-entered "text" cell.
function csvSafeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export async function GET(request: Request) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "all";
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 254);

  const where: Prisma.NewsletterSubscriberWhereInput = {
    ...(STATUS_WHERE[status] ?? {}),
    ...(query ? { email: { contains: query, mode: "insensitive" } } : {}),
  };

  const subscribers = await db.newsletterSubscriber.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      email: true,
      source: true,
      consentGiven: true,
      confirmedAt: true,
      unsubscribedAt: true,
      createdAt: true,
    },
  });

  const rows: string[][] = [
    ["email", "source", "status", "consent_given", "confirmed_at", "unsubscribed_at", "created_at"],
    ...subscribers.map((subscriber) => {
      const statusLabel = subscriber.unsubscribedAt
        ? "unsubscribed"
        : subscriber.confirmedAt
          ? "active"
          : "pending";
      return [
        csvSafeCell(subscriber.email),
        csvSafeCell(subscriber.source),
        statusLabel,
        String(subscriber.consentGiven),
        subscriber.confirmedAt?.toISOString() ?? "",
        subscriber.unsubscribedAt?.toISOString() ?? "",
        subscriber.createdAt.toISOString(),
      ];
    }),
  ];

  // F-153 fix guidance: PII leaving the system is worth an audit trail,
  // same as any other admin export.
  await logAuditEvent({
    userId: session.id,
    action: "export",
    entity: "newsletter_subscriber",
    metadata: { status, query: query || undefined, count: subscribers.length },
  });

  return new Response(stringifyCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="newsletter-subscribers.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
