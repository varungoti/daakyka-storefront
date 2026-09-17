"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface CustomerListItem {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  emailVerified: boolean;
  active: boolean;
  orderCount: number;
  totalSpent: number;
  createdAt: string;
}

function formatInr(amount: number): string {
  return `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * Admin customers list (Phase D4), following the same client-fetch +
 * search/pagination pattern as ProductsTable/OrdersTable.
 */
export function CustomersTable() {
  const [items, setItems] = useState<CustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (search.trim()) params.set("search", search.trim());
    if (active) params.set("active", active);

    const response = await fetch(`/api/admin/customers?${params}`);
    if (response.ok) {
      const body = await response.json();
      setItems(body.items);
      setTotal(body.total);
      setTotalPages(body.totalPages);
    }
    setLoading(false);
  }, [page, search, active]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [search, active]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or phone…"
          className="w-72 rounded-xl border border-border p-2 text-sm"
        />
        <select value={active} onChange={(e) => setActive(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
          <option value="">All customers</option>
          <option value="true">Active only</option>
          <option value="false">Inactive only</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[840px] text-sm">
          <thead className="bg-surface-muted text-left text-xs font-semibold text-muted">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Contact</th>
              <th className="p-3">Orders</th>
              <th className="p-3">Total spent</th>
              <th className="p-3">Joined</th>
              <th className="p-3">Status</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted">
                  No customers found.
                </td>
              </tr>
            ) : (
              items.map((c) => (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="p-3">
                    <Link href={`/admin/customers/${c.id}`} className="font-semibold text-ink hover:underline">
                      {c.name}
                    </Link>
                    {c.emailVerified ? (
                      <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Verified</span>
                    ) : (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Unverified</span>
                    )}
                  </td>
                  <td className="p-3">
                    <p className="text-ink">{c.email}</p>
                    {c.phone && <p className="text-xs text-muted">{c.phone}</p>}
                  </td>
                  <td className="p-3">{c.orderCount}</td>
                  <td className="p-3 font-semibold text-ink">{formatInr(c.totalSpent)}</td>
                  <td className="p-3 text-muted">{new Date(c.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-700"}`}>
                      {c.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Link href={`/admin/customers/${c.id}`} className="text-xs font-semibold text-brand hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>{total} customers</span>
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
