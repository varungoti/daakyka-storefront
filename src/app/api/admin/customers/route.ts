import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { listCustomersForAdmin } from "@/lib/customers/admin-customers";

export async function GET(request: Request) {
  const { error } = await requireAdminPermission("customers:view");
  if (error) return error;

  const url = new URL(request.url);
  const activeParam = url.searchParams.get("active");

  const result = await listCustomersForAdmin({
    search: url.searchParams.get("search") ?? undefined,
    active: activeParam === "true" ? true : activeParam === "false" ? false : undefined,
    page: Number(url.searchParams.get("page")) || 1,
    pageSize: Number(url.searchParams.get("pageSize")) || undefined,
  });

  return NextResponse.json(result);
}
