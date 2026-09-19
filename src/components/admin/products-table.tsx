"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

interface ProductListItem {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryName: string;
  categorySlug: string;
  price: number;
  compareAtPrice: number | null;
  totalStock: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  hasAiImage: boolean;
  thumbnailUrl: string | null;
}

interface CategoryOption {
  id: string;
  name: string;
  section: string;
}

/**
 * Admin products list (Phase B1): search/filter/sort against
 * `/api/admin/products`, checkbox selection + a bulk action bar, and
 * simple page-number pagination. All data fetching happens client-side
 * against the JSON API so filters can change without a full navigation.
 */
export function ProductsTable({
  categoryOptions,
  canManage,
  canPublish,
}: {
  categoryOptions: CategoryOption[];
  canManage: boolean;
  canPublish: boolean;
}) {
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const initialParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [status, setStatus] = useState(() => initialParams.get("status") ?? "");
  const [stockFilter, setStockFilter] = useState(() => initialParams.get("stockFilter") ?? "all");
  const [sort, setSort] = useState("updated-desc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), sort });
    if (search.trim()) params.set("search", search.trim());
    if (categorySlug) params.set("categorySlug", categorySlug);
    if (status) params.set("status", status);
    if (stockFilter !== "all") params.set("stockFilter", stockFilter);

    const response = await fetch(`/api/admin/products?${params}`);
    if (response.ok) {
      const body = await response.json();
      setItems(body.items);
      setTotal(body.total);
      setTotalPages(body.totalPages);
    }
    setLoading(false);
  }, [page, sort, search, categorySlug, status, stockFilter]);

  useEffect(() => {
    // Fetch-on-filter-change effect (react.dev/reference/react/useEffect#fetching-data-with-effects):
    // `load` sets `loading` synchronously as its first statement so the
    // "Loading…" row shows immediately rather than after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // Any filter change should jump back to page 1 immediately, before
    // the (now stale) page number is used to build the next request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [search, categorySlug, status, stockFilter]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  async function runBulk(action: string, extra: Record<string, unknown> = {}) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setNotice(null);
    const response = await fetch("/api/admin/products/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ids: Array.from(selected), ...extra }),
    });
    setBulkBusy(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setNotice(body?.error ?? `Couldn't ${action}.`);
      return;
    }
    // adjust-price-pct can partially apply: rows that would push price
    // past the product's compareAtPrice are skipped rather than silently
    // corrupted or failing the whole batch — surface that here instead of
    // dropping it (F6).
    const body: { skipped?: { id: string; name: string; reason: string }[] } = await response.json().catch(() => ({}));
    if (body.skipped && body.skipped.length > 0) {
      const count = body.skipped.length;
      const names = body.skipped.map((s) => s.name).join(", ");
      setNotice(`${count} product${count === 1 ? "" : "s"} skipped (${body.skipped[0].reason}): ${names}`);
    }
    setSelected(new Set());
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, slug, or tag…"
          className="w-64 rounded-xl border border-border p-2 text-sm"
        />
        <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
          <option value="">All categories</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
          <option value="all">All stock</option>
          <option value="low">Low stock (&lt;10)</option>
          <option value="out">Out of stock</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
          <option value="updated-desc">Recently updated</option>
          <option value="name-asc">Name A–Z</option>
          <option value="name-desc">Name Z–A</option>
          <option value="price-asc">Price low–high</option>
          <option value="price-desc">Price high–low</option>
          <option value="stock-asc">Stock low–high</option>
        </select>
      </div>

      {canManage && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand/5 p-3">
          <span className="text-xs font-semibold text-ink">{selected.size} selected</span>
          <span title={canPublish ? "" : "Requires products:publish"}>
            <button disabled={!canPublish || bulkBusy} onClick={() => runBulk("publish")} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40">
              Publish
            </button>
          </span>
          <button disabled={bulkBusy} onClick={() => runBulk("archive")} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
            Archive
          </button>
          <button
            disabled={bulkBusy}
            onClick={() => {
              const pct = Number(prompt("Adjust price by what percent? (e.g. -10 for -10%)", "0"));
              if (!Number.isNaN(pct) && pct !== 0) runBulk("adjust-price-pct", { percent: pct });
            }}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
          >
            Adjust price %
          </button>
          <button
            disabled={bulkBusy}
            onClick={() => {
              const stock = Number(prompt("Set stock to what value for all variants?", "0"));
              if (!Number.isNaN(stock) && stock >= 0) runBulk("set-stock", { stock });
            }}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
          >
            Set stock
          </button>
          <select
            onChange={(e) => {
              if (e.target.value) runBulk("move-category", { categoryId: e.target.value });
              e.target.value = "";
            }}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
            defaultValue=""
          >
            <option value="" disabled>
              Move to category…
            </option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {notice ? <p className="text-xs text-red-600">{notice}</p> : null}

      {/* F-05 (docs/audit-2026-09-19/admin-ux.md): the desktop table below
          is unchanged and still renders at `lg` (1024px) and up — the same
          breakpoint the sidebar itself collapses to a hamburger at (see
          admin-shell.tsx), so a stacked card layout takes over for exactly
          the range where the persistent sidebar is already gone, covering
          both audited widths (390×844 and 768×1024). */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border lg:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-surface-muted text-left text-xs font-semibold text-muted">
            <tr>
              {canManage && (
                <th className="p-3">
                  <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} />
                </th>
              )}
              <th className="p-3">Product</th>
              <th className="p-3">Category</th>
              <th className="p-3">Price</th>
              <th className="p-3">Stock</th>
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
                  No products found.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  {canManage && (
                    <td className="p-3">
                      <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} />
                    </td>
                  )}
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-border bg-lavender/40">
                        {item.thumbnailUrl ? <Image src={item.thumbnailUrl} alt={item.name} fill className="object-cover" sizes="48px" /> : null}
                      </div>
                      <div>
                        <Link href={`/admin/products/${item.id}`} className="font-semibold text-ink hover:underline">
                          {item.name}
                        </Link>
                        {item.hasAiImage ? <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">AI image</span> : null}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 text-muted">{item.categoryName}</td>
                  <td className="p-3">
                    ₹{item.price.toLocaleString("en-IN")}
                    {item.compareAtPrice ? <span className="ml-1 text-xs text-muted line-through">₹{item.compareAtPrice.toLocaleString("en-IN")}</span> : null}
                  </td>
                  <td className="p-3">
                    {item.totalStock}
                    {item.totalStock === 0 ? (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Out of stock</span>
                    ) : item.totalStock < 10 ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Low stock</span>
                    ) : null}
                  </td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        item.status === "ACTIVE" ? "bg-green-100 text-green-700" : item.status === "ARCHIVED" ? "bg-gray-200 text-gray-700" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Link href={`/admin/products/${item.id}`} className="text-xs font-semibold text-brand hover:underline">
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile/tablet stacked-card layout (below `lg`) — mirrors the
          table's own columns and every action (checkbox select, Edit link)
          so nothing needs horizontal scrolling to reach. */}
      <div className="space-y-3 lg:hidden">
        {loading ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface p-6 text-center text-sm text-muted">No products found.</p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-border bg-surface p-4">
              <div className="flex items-start gap-3">
                {canManage && (
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelected(item.id)}
                    aria-label={`Select ${item.name}`}
                    className="mt-2 shrink-0"
                  />
                )}
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-lavender/40">
                  {item.thumbnailUrl ? <Image src={item.thumbnailUrl} alt={item.name} fill className="object-cover" sizes="56px" /> : null}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/products/${item.id}`} className="font-semibold text-ink hover:underline">
                    {item.name}
                  </Link>
                  {item.hasAiImage ? <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">AI image</span> : null}
                  <p className="text-xs text-muted">{item.categoryName}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    item.status === "ACTIVE" ? "bg-green-100 text-green-700" : item.status === "ARCHIVED" ? "bg-gray-200 text-gray-700" : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {item.status}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-y-2 border-t border-border pt-3 text-xs">
                <div>
                  <dt className="text-muted">Price</dt>
                  <dd className="font-semibold text-ink">
                    ₹{item.price.toLocaleString("en-IN")}
                    {item.compareAtPrice ? <span className="ml-1 font-normal text-muted line-through">₹{item.compareAtPrice.toLocaleString("en-IN")}</span> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Stock</dt>
                  <dd className="text-ink">
                    {item.totalStock}
                    {item.totalStock === 0 ? (
                      <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Out of stock</span>
                    ) : item.totalStock < 10 ? (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Low stock</span>
                    ) : null}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 text-right">
                <Link href={`/admin/products/${item.id}`} className="text-xs font-semibold text-brand hover:underline">
                  Edit
                </Link>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        {/* F-03: `total` starts at 0, so rendering it unconditionally
            raced the table body's own "Loading…" state and flashed "0
            products" on every fresh navigation, before the same fetch
            that fills the table had resolved. Gate it on the same
            `loading` flag instead of introducing a second data source. */}
        <span>{loading ? "Loading…" : `${total} products`}</span>
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
