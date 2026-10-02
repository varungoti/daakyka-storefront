"use client";

import { useCallback, useEffect, useState } from "react";

interface GuestBuyerItem {
  email: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string;
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * F-198 fix: guest checkouts (no `Customer` account) never appeared
 * anywhere in /admin/customers, even though most orders here are guest
 * orders. This is deliberately simpler than CustomersTable — a guest row
 * has no id to link to a detail page, so "View orders" links to the Orders
 * list pre-filtered by email instead.
 */
export function GuestBuyersTable() {
  const [items, setItems] = useState<GuestBuyerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (search.trim()) params.set("search", search.trim());

    const response = await fetch(`/api/admin/customers/guests?${params}`);
    if (response.ok) {
      const body = await response.json();
      setItems(body.items);
      setTotal(body.total);
      setTotalPages(body.totalPages);
    }
    setLoading(false);
  }, [page, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [search]);

  return (
    <div className="space-y-4">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by email…"
        aria-label="Search guest buyers by email"
        className="w-72 rounded-xl border border-border p-2 text-sm"
      />

      <div className="hidden overflow-x-auto rounded-2xl border border-border lg:block">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-muted text-left text-xs font-semibold text-muted">
            <tr>
              <th className="p-3">Email</th>
              <th className="p-3">Orders</th>
              <th className="p-3">Total spent</th>
              <th className="p-3">Last order</th>
              <th className="p-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  No guest orders found.
                </td>
              </tr>
            ) : (
              items.map((g) => (
                <tr key={g.email} className="border-t border-border align-top">
                  <td className="p-3 text-ink">{g.email}</td>
                  <td className="p-3">{g.orderCount}</td>
                  <td className="p-3 font-semibold text-ink">{formatInr(g.totalSpent)}</td>
                  <td className="p-3 text-muted">{new Date(g.lastOrderAt).toLocaleDateString("en-IN")}</td>
                  <td className="p-3 text-right">
                    <a
                      href={`/admin/orders?search=${encodeURIComponent(g.email)}`}
                      className="text-xs font-semibold text-brand hover:underline"
                    >
                      View orders
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 lg:hidden">
        {loading ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">
            No guest orders found.
          </p>
        ) : (
          items.map((g) => (
            <div key={g.email} className="rounded-2xl border border-border bg-surface p-4">
              <p className="font-semibold text-ink">{g.email}</p>
              <dl className="mt-3 grid grid-cols-2 gap-y-2 border-t border-border pt-3 text-xs">
                <div>
                  <dt className="text-muted">Orders</dt>
                  <dd className="text-ink">{g.orderCount}</dd>
                </div>
                <div>
                  <dt className="text-muted">Total spent</dt>
                  <dd className="font-semibold text-ink">{formatInr(g.totalSpent)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Last order</dt>
                  <dd className="text-ink">{new Date(g.lastOrderAt).toLocaleDateString("en-IN")}</dd>
                </div>
              </dl>
              <div className="mt-3 text-right">
                <a
                  href={`/admin/orders?search=${encodeURIComponent(g.email)}`}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  View orders
                </a>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{total} guest buyers</span>
        <div className="flex items-center gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
