import { requireAdminPermission } from "@/lib/auth/admin-api";
import { exportOrdersCsv, orderStatusValues, paymentMethodValues } from "@/lib/orders/admin-orders";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request) {
  const { error } = await requireAdminPermission("orders:view");
  if (error) return error;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const paymentMethod = url.searchParams.get("paymentMethod");

  const csv = await exportOrdersCsv({
    search: url.searchParams.get("search") ?? undefined,
    status: status && (orderStatusValues as readonly string[]).includes(status) ? (status as OrderStatus) : undefined,
    paymentMethod:
      paymentMethod && (paymentMethodValues as readonly string[]).includes(paymentMethod)
        ? (paymentMethod as PaymentMethod)
        : undefined,
    dateFrom: parseDate(url.searchParams.get("dateFrom")),
    dateTo: parseDate(url.searchParams.get("dateTo")),
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="orders-export.csv"',
    },
  });
}
