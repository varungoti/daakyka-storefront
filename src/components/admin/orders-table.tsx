"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatInrExact } from "@/lib/currency/admin-money";
import { createLoadGuard, debounce, normalizeSearchTerm } from "@/lib/admin/list-query";

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

// F-199 fix: RETURNED is now a reachable status (see status-transitions.ts)
// — omitting it here just meant an admin could never filter for it, not
// that it couldn't occur.
const STATUS_OPTIONS = ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED", "RETURNED"];
const PAYMENT_OPTIONS = ["RAZORPAY", "ORDER_REQUEST"];

const STATUS_STYLES: Record<string, string> = {
  PENDING_PAYMENT: "bg-amber-100 text-amber-700",
  PAID: "bg-green-100 text-green-700",
  PROCESSING: "bg-blue-100 text-blue-700",
  SHIPPED: "bg-indigo-100 text-indigo-700",
  DELIVERED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-gray-200 text-gray-700",
  REFUNDED: "bg-red-100 text-red-700",
  RETURNED: "bg-orange-100 text-orange-700",
};

// F-202 fix: was a local `maximumFractionDigits: 0` formatter, which
// silently rounded any order with paise (any percentage-discount order)
// to the nearest whole rupee — see src/lib/currency/admin-money.ts.
function formatInr(amount: number): string {
  return formatInrExact(amount);
}

/** F-200 fix: filter/search/sort/page state that should survive a
 * round trip to an order's detail page and back — read once, on mount,
 * from the current URL (not `useSearchParams`, so this client component
 * needs no Suspense boundary from its server-rendered parent). */
interface OrdersFilterState {
  search: string;
  status: string;
  paymentMethod: string;
  dateFrom: string;
  dateTo: string;
  sort: string;
  page: number;
}

const DEFAULT_FILTERS: OrdersFilterState = {
  search: "",
  status: "",
  paymentMethod: "",
  dateFrom: "",
  dateTo: "",
  sort: "createdAt-desc",
  page: 1,
};

function readFiltersFromLocation(): OrdersFilterState {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  const params = new URLSearchParams(window.location.search);
  const page = Number(params.get("page"));
  return {
    search: params.get("q") ?? "",
    status: params.get("status") ?? "",
    paymentMethod: params.get("paymentMethod") ?? "",
    dateFrom: params.get("dateFrom") ?? "",
    dateTo: params.get("dateTo") ?? "",
    sort: params.get("sort") ?? DEFAULT_FILTERS.sort,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * Admin orders list (Phase D4): search/filter/sort against
 * `/api/admin/orders`, plus a CSV export link that carries the same
 * filters through as query params so "export" always matches what's on
 * screen. Follows the same client-fetch pattern as ProductsTable
 * (src/components/admin/products-table.tsx).
 *
 * F-200 fix: search now also matches a customer's name and phone (see
 * admin-orders.ts's buildOrderWhere), the search input is debounced so
 * every keystroke doesn't fire its own request, and every filter/the
 * current page is mirrored into the URL (via `history.replaceState`, not a
 * Next navigation — this is just reflecting client state, not routing) so
 * opening an order and pressing Back restores exactly what was on screen,
 * and the list is shareable/bookmarkable with its filters intact.
 */
export function OrdersTable() {
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Lazy `useState` initializer: `readFiltersFromLocation` only actually
  // runs once, on mount — a plain call here would re-parse
  // `window.location.search` on every render for a value React would
  // discard after the first anyway.
  const [initialFilters] = useState(readFiltersFromLocation);
  const [page, setPage] = useState(initialFilters.page);
  // `searchInput` is what the text field shows (updates every keystroke);
  // `search` is what's actually queried/URL-synced, 300ms after the admin
  // stops typing.
  const [searchInput, setSearchInput] = useState(initialFilters.search);
  const [search, setSearch] = useState(initialFilters.search);
  const [status, setStatus] = useState(initialFilters.status);
  const [paymentMethod, setPaymentMethod] = useState(initialFilters.paymentMethod);
  const [dateFrom, setDateFrom] = useState(initialFilters.dateFrom);
  const [dateTo, setDateTo] = useState(initialFilters.dateTo);
  const [sort, setSort] = useState(initialFilters.sort);

  // F-341 fix: debounced straight from the input's onChange below, rather
  // than a `useEffect` keyed on `searchInput` — nothing schedules a call
  // until the admin actually types, so mount never needs a "skip the first
  // run" guard the way this used to (that guard existed only to stop the
  // debounce's own post-mount fire from resetting `page` back to 1, which
  // would have thrown away a page number just read from the URL, e.g.
  // after Back from an order on page 3). A lazy `useState` initializer,
  // not `useRef` — the same "run once, keep across renders" pattern
  // `initialFilters` above uses; `react-hooks/refs` forbids reading
  // `.current` during render, which a `useRef(...).current` one-liner does.
  const [debouncedSetSearch] = useState(() =>
    debounce((value: string) => {
      setSearch(value);
      setPage(1);
    }, 300),
  );
  useEffect(() => () => debouncedSetSearch.cancel(), [debouncedSetSearch]);

  // F-341 fix: each load() records the request id it started with and
  // only applies its response while still current — a slower, earlier
  // request (e.g. a shorter search prefix) resolving after a faster, later
  // one already has is dropped instead of overwriting the table with
  // stale data.
  const [loadGuard] = useState(createLoadGuard);

  /** Resets to page 1 whenever a filter (not the debounced search input,
   * which resets its own page above once it actually takes effect) changes
   * — called from each control's own onChange rather than a `useEffect`,
   * so this never fires on mount and clobbers a page number read from the
   * URL. */
  function updateFilter<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), sort });
    // F-341 fix: a 1-character prefix matches a large share of the table
    // (see the finding's repro) — below MIN_SEARCH_CHARS, this behaves as
    // if the search box were empty rather than querying on it.
    const term = normalizeSearchTerm(search);
    if (term) params.set("q", term);
    if (status) params.set("status", status);
    if (paymentMethod) params.set("paymentMethod", paymentMethod);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  }, [page, sort, search, status, paymentMethod, dateFrom, dateTo]);

  const load = useCallback(async () => {
    const requestId = loadGuard.start();
    setLoading(true);
    const apiParams = new URLSearchParams(buildParams());
    const searchTerm = apiParams.get("q");
    apiParams.delete("q");
    if (searchTerm) apiParams.set("search", searchTerm);
    const response = await fetch(`/api/admin/orders?${apiParams}`);
    // F-341 fix: a response for a request that's no longer the latest one
    // in flight is dropped rather than applied — see loadGuard above.
    if (response.ok) {
      const body = await response.json();
      if (!loadGuard.isCurrent(requestId)) return;
      setItems(body.items);
      setTotal(body.total);
      setTotalPages(body.totalPages);
      setLoading(false);
    } else if (loadGuard.isCurrent(requestId)) {
      setLoading(false);
    }
  }, [buildParams, loadGuard]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // F-200 fix: mirrors the current filters/page into the URL so a Back
  // navigation from an order's detail page (or a reload/bookmark) restores
  // them. `replaceState`, not `router.replace` — this is reflecting
  // already-fetched client state, not a page navigation, and doesn't need
  // the server component above to re-render.
  useEffect(() => {
    const qs = buildParams().toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [buildParams]);

  const exportParams = buildParams();
  exportParams.delete("page");
  exportParams.delete("sort");
  const exportSearchTerm = exportParams.get("q");
  exportParams.delete("q");
  if (exportSearchTerm) exportParams.set("search", exportSearchTerm);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={searchInput}
          onChange={(e) => {
            const value = e.target.value;
            setSearchInput(value);
            debouncedSetSearch(value);
          }}
          placeholder="Search order #, name, email or phone…"
          aria-label="Search orders"
          className="w-64 rounded-xl border border-border p-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => updateFilter(setStatus, e.target.value)}
          aria-label="Filter by status"
          className="rounded-xl border border-border p-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select
          value={paymentMethod}
          onChange={(e) => updateFilter(setPaymentMethod, e.target.value)}
          aria-label="Filter by payment method"
          className="rounded-xl border border-border p-2 text-sm"
        >
          <option value="">All payment methods</option>
          {PAYMENT_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p === "RAZORPAY" ? "Razorpay" : "Order Request"}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted">
          From
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => updateFilter(setDateFrom, e.target.value)}
            className="rounded-xl border border-border p-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          To
          <input
            type="date"
            value={dateTo}
            onChange={(e) => updateFilter(setDateTo, e.target.value)}
            className="rounded-xl border border-border p-2 text-sm"
          />
        </label>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort orders"
          className="rounded-xl border border-border p-2 text-sm"
        >
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

      {/* F-332 fix: was `lg` (1024px) — at 1024–1279px (an iPad in
          landscape, or any 1024x768 touch viewport) this table's
          min-w-[900px] pushed Status, Payment and the View link off-screen
          behind an easy-to-miss horizontal scrollbar, with nothing on
          screen signalling there was more to see. `xl` (1280px) is the
          first width the table actually has room for every column beside
          the sidebar — see the matching comment in products-table.tsx. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border xl:block">
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
              <th className="p-3">
                <span className="sr-only">Actions</span>
              </th>
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
                      <span className="sr-only"> order {order.number}</span>
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile/tablet stacked-card layout (below `xl` — see the F-332 fix
          comment above). */}
      <div className="space-y-3 xl:hidden">
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
                  <span className="sr-only"> order {order.number}</span>
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
