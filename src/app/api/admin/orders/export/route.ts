import { requireAdminPermission } from "@/lib/auth/admin-api";
import { streamOrdersCsv, orderStatusValues, paymentMethodValues } from "@/lib/orders/admin-orders";
import { parseIstDateOnly, parseIstDateOnlyExclusiveEnd, STORE_TZ } from "@/lib/format/datetime";
import { logAuditEvent } from "@/lib/auth/audit";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

export async function GET(request: Request) {
  const { session, error } = await requireAdminPermission("orders:view");
  if (error) return error;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const paymentMethod = url.searchParams.get("paymentMethod");
  const filters = {
    search: url.searchParams.get("search") ?? undefined,
    status: status && (orderStatusValues as readonly string[]).includes(status) ? (status as OrderStatus) : undefined,
    paymentMethod:
      paymentMethod && (paymentMethodValues as readonly string[]).includes(paymentMethod)
        ? (paymentMethod as PaymentMethod)
        : undefined,
    // F-068 fix: see the matching comment in ../route.ts.
    dateFrom: parseIstDateOnly(url.searchParams.get("dateFrom")),
    dateTo: parseIstDateOnlyExclusiveEnd(url.searchParams.get("dateTo")),
  };

  // F-290 fix: this CSV carries every matching order's email and phone —
  // a bulk PII export with no prior audit trail at all. Logged before the
  // stream is handed back (not after it finishes) since a streamed
  // Response has no single point where "the export completed" could hang
  // this on; the filters recorded here are exactly what was requested,
  // which is what an owner reviewing the audit log needs to know.
  await logAuditEvent({
    userId: session.id,
    action: "export",
    entity: "order",
    metadata: { filters: { ...filters, dateFrom: filters.dateFrom?.toISOString(), dateTo: filters.dateTo?.toISOString() } },
  });

  // F-342 fix: streamed in cursor-paginated batches instead of building the
  // whole CSV as one in-memory string — see streamOrdersCsv's doc comment.
  const stream = streamOrdersCsv(filters);

  // F-204 fix: the filename carries today's IST calendar date (en-CA gives
  // a plain "YYYY-MM-DD" — same trick as startOfTodayIST), so a courier/GST
  // export downloaded twice in a day doesn't silently overwrite (or get
  // confused with) yesterday's file in Downloads.
  const filenameDate = new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ }).format(new Date());

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="orders-export-${filenameDate}.csv"`,
    },
  });
}
