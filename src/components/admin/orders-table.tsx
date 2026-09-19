"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface OrderListItem {
  id: string;
  number: string;
  email: string;
  customerName: string | null;
  guestName: string | null;
  itemCount: number;
  total: number;
  currency: string;
  status: string;
  paymentMethod: string;
  createdAt: string;
}

const STATUS_OPTIONS = ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"];
const PAYMENT_OPTIONS = ["RAZORPAY", "ORDER_REQUEST"];

const STATUS_STYLES: Record<string, string> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  PROCESSING: "bg-blue-100 text-blue-700",
  SHIPPED: "bg-indigo-100 text-indigo-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-gray-200 text-gray-700",
  REFUNDED: "bg-red-100 text-red-700",
};

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Admin orders list (Phase D4): search/filter/sort against
 * `/api/admin/orders`, plus a CSV export link that carries the same
 * filters through as query params so "export" always matches what's on
 * screen. Follows the same client-fetch pattern as ProductsTable
 * (src/components/admin/products-table.tsx).
 */
export function OrdersTable() {
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState("createdAt-desc");

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), sort });
    if (search.trim()) params.set("search", search.trim());
    if (status) params.set("status", status);
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  }, [page, sort, search, status, paymentMethod, dateFrom, dateTo]);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/admin/orders?${buildParams()}`);
    if (response.ok) {
      const body = await response.json();
      setItems(body.items);
      setTotal(body.total);
      setTotalPages(body.totalPages);
    }
    setLoading(false);
  }, [buildParams]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [search, status, paymentMethod, dateFrom, dateTo]);

  const exportParams = buildParams();
  exportParams.delete("page");
  exportParams.delete("sort");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by order number or email…"
          className="w-64 rounded-xl border border-border p-2 text-sm"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
          <option value="">All payment methods</option>
          {PAYMENT_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p === "RAZORPAY" ? "Razorpay" : "Order Request"}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted">
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded-xl border border-border p-2 text-sm" />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded-xl border border-border p-2 text-sm" />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
          <option value="createdAt-desc">Newest first</option>
          <option value="createdAt-asc">Oldest first</option>
          <option value="total-desc">Total high–low</option>
          <option value="total-asc">Total low–high</option>
        </select>
        <a
          href={`/api/admin/orders/export?${exportParams}`}
          className="ml-auto rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-lavender/30"
        >
          Export CSV
        </a>
      </div>

      {/* F-05 (docs/audit-2026-09-19/admin-ux.md): desktop table unchanged,
          `lg` and up only — see the matching comment in products-table.tsx
          for why `lg` (matching the sidebar's own hamburger breakpoint) was
          chosen over the more common `sm`. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border lg:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-muted text-left text-xs font-semibold text-muted">
            <tr>
              <th className="p-3">Order</th>
              <th className="p-3">Customer</th>
              <th className="p-3">Date</th>
              <th className="p-3">Items</th>
              <th className="p-3">Total</th>
              <th className="p-3">Status</th>
              <th className="p-3">Payment</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted">
                  No orders found.
                </td>
              </tr>
            ) : (
              items.map((order) => (
                <tr key={order.id} className="border-t border-border align-top">
                  <td className="p-3">
                    <Link href={`/admin/orders/${order.id}`} className="font-semibold text-ink hover:underline">
                      {order.number}
                    </Link>
                  </td>
                  <td className="p-3">
                    <p className="text-ink">{order.customerName ?? order.guestName ?? "Guest"}</p>
                    <p className="text-xs text-muted">{order.email}</p>
                  </td>
                  <td className="p-3 text-muted">{new Date(order.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="p-3">{order.itemCount}</td>
                  <td className="p-3 font-semibold text-ink">{formatInr(order.total)}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[order.status] ?? "bg-gray-100 text-gray-700"}`}>
                      {order.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="p-3 text-muted">{order.paymentMethod === "RAZORPAY" ? "Razorpay" : "Order Request"}</td>
                  <td className="p-3 text-right">
                    <Link href={`/admin/orders/${order.id}`} className="text-xs font-semibold text-brand hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile/tablet stacked-card layout (below `lg`). */}
      <div className="space-y-3 lg:hidden">
        {loading ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">No orders found.</p>
        ) : (
          items.map((order) => (
            <div key={order.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/admin/orders/${order.id}`} className="font-semibold text-ink hover:underline">
                    {order.number}
                  </Link>
                  <p className="text-ink">{order.customerName ?? order.guestName ?? "Guest"}</p>
                  <p className="truncate text-xs text-muted">{order.email}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[order.status] ?? "bg-gray-100 text-gray-700"}`}>
                  {order.status.replace("_", " ")}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-2 border-t border-border pt-3 text-xs">
                <div>
                  <dt className="text-muted">Date</dt>
                  <dd className="text-ink">{new Date(order.createdAt).toLocaleDateString("en-IN")}</dd>
                </div>
                <div>
                  <dt className="text-muted">Items</dt>
                  <dd className="text-ink">{order.itemCount}</dd>
                </div>
                <div>
                  <dt className="text-muted">Total</dt>
                  <dd className="font-semibold text-ink">{formatInr(order.total)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Payment</dt>
                  <dd className="text-ink">{order.paymentMethod === "RAZORPAY" ? "Razorpay" : "Order Request"}</dd>
                </div>
              </dl>
              <div className="mt-3 text-right">
                <Link href={`/admin/orders/${order.id}`} className="text-xs font-semibold text-brand hover:underline">
                  View
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{total} orders</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-40">
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
