import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import {
  listOrdersForAdmin,
  orderListSortValues,
  orderStatusValues,
  paymentMethodValues,
  type OrderListSort,
} from "@/lib/orders/admin-orders";
import { parseIstDateOnly, parseIstDateOnlyExclusiveEnd } from "@/lib/format/datetime";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

export async function GET(request: Request) {
  const { error } = await requireAdminPermission("orders:view");
  if (error) return error;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const paymentMethod = url.searchParams.get("paymentMethod");
  const sort = url.searchParams.get("sort");

  const result = await listOrdersForAdmin({
    search: url.searchParams.get("search") ?? undefined,
    status: status && (orderStatusValues as readonly string[]).includes(status) ? (status as OrderStatus) : undefined,
    paymentMethod:
      paymentMethod && (paymentMethodValues as readonly string[]).includes(paymentMethod)
        ? (paymentMethod as PaymentMethod)
        : undefined,
    // F-068 fix: parsed as IST calendar-day boundaries, not
    // `new Date(value)` (which reads a date-only string as UTC midnight —
    // 05:30 IST — and used to drop the whole "To" day). `dateTo` is the
    // *exclusive* upper bound (see admin-orders.ts's buildOrderWhere).
    dateFrom: parseIstDateOnly(url.searchParams.get("dateFrom")),
    dateTo: parseIstDateOnlyExclusiveEnd(url.searchParams.get("dateTo")),
    sort: sort && (orderListSortValues as readonly string[]).includes(sort) ? (sort as OrderListSort) : undefined,
    page: Number(url.searchParams.get("page")) || 1,
    pageSize: Number(url.searchParams.get("pageSize")) || undefined,
  });

  return NextResponse.json(result);
}
