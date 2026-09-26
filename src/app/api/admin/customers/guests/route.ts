import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { listGuestBuyersForAdmin } from "@/lib/customers/admin-customers";

/**
 * F-198 fix: guest checkouts (no `Customer` account) never showed up
 * anywhere in /admin/customers, even though most orders at this store are
 * guest orders. Same permission as GET /api/admin/customers — this is
 * still "who has bought from us", just grouped by email instead of by
 * account.
 */
export async function GET(request: Request) {
  const { error } = await requireAdminPermission("customers:view");
  if (error) return error;

  const url = new URL(request.url);

  const result = await listGuestBuyersForAdmin({
    search: url.searchParams.get("search") ?? undefined,
    page: Number(url.searchParams.get("page")) || 1,
    pageSize: Number(url.searchParams.get("pageSize")) || undefined,
  });

  return NextResponse.json(result);
}
