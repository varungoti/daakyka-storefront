import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import {
  listOrdersForAdmin,
  orderListSortValues,
  orderStatusValues,
  paymentMethodValues,
  type OrderListSort,
} from "@/lib/orders/admin-orders";
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
  const sort = url.searchParams.get("sort");

  const result = await listOrdersForAdmin({
    search: url.searchParams.get("search") ?? undefined,
    status: status && (orderStatusValues as readonly string[]).includes(status) ? (status as OrderStatus) : undefined,
    paymentMethod:
      paymentMethod && (paymentMethodValues as readonly string[]).includes(paymentMethod)
        ? (paymentMethod as PaymentMethod)
        : undefined,
    dateFrom: parseDate(url.searchParams.get("dateFrom")),
    dateTo: parseDate(url.searchParams.get("dateTo")),
    sort: sort && (orderListSortValues as readonly string[]).includes(sort) ? (sort as OrderListSort) : undefined,
    page: Number(url.searchParams.get("page")) || 1,
    pageSize: Number(url.searchParams.get("pageSize")) || undefined,
  });

  return NextResponse.json(result);
}
