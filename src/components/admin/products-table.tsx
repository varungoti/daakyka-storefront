"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createLoadGuard, debounce, normalizeSearchTerm } from "@/lib/admin/list-query";

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
  // F-341 fix: `searchInput` is what the text field shows (updates every
  // keystroke); `search` is what's actually queried, 300ms after the admin
  // stops typing — same split as OrdersTable
  // (src/components/admin/orders-table.tsx), which this mirrors.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // F-177: the filter's <option> values are category ids (categoryOptions
  // only ever carries id/name/section — there's no slug to use instead),
  // so this has to be sent as `categoryId`, the param
  // GET /api/admin/products actually filters on. It used to be sent as
  // `categorySlug`, which the API filters with `category: { slug }` — a
  // cuid never equals a slug, so every category choice silently matched
  // zero products.
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState(() => initialParams.get("status") ?? "");
  const [stockFilter, setStockFilter] = useState(() => initialParams.get("stockFilter") ?? "all");
  const [sort, setSort] = useState("updated-desc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // F-189: a one-off success confirmation (e.g. "12 products archived"),
  // separate from `notice` — that's reserved for errors/skips and renders
  // in red, which a success message must not.
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Lazy `useState` initializers, not `useRef` — `react-hooks/refs`
  // forbids reading `.current` during render, which a `useRef(...).current`
  // one-liner does; see the matching comment in orders-table.tsx.
  const [debouncedSetSearch] = useState(() => debounce((value: string) => setSearch(value), 300));
  useEffect(() => () => debouncedSetSearch.cancel(), [debouncedSetSearch]);

  // F-341 fix: drops a response for a request that's no longer the latest
  // one in flight (a slower, earlier search/filter resolving after a
  // faster, later one already has) instead of applying it.
  const [loadGuard] = useState(createLoadGuard);

  const load = useCallback(async () => {
    const requestId = loadGuard.start();
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), sort });
    // F-341 fix: below MIN_SEARCH_CHARS, behaves as if the search box were
    // empty rather than querying the server on a 1-character prefix.
    const term = normalizeSearchTerm(search);
    if (term) params.set("search", term);
    if (categoryId) params.set("categoryId", categoryId);
    if (status) params.set("status", status);
    if (stockFilter !== "all") params.set("stockFilter", stockFilter);

    const response = await fetch(`/api/admin/products?${params}`);
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
  }, [page, sort, search, categoryId, status, stockFilter, loadGuard]);

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
  }, [search, categoryId, status, stockFilter]);

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

  // F-189: `onSuccess` is a per-caller success message — archive and
  // move-category used to run instantly with zero feedback beyond the
  // selection silently clearing, which reads the same whether the action
  // actually worked or the request never fired. Only shown when nothing
  // was skipped, so it never talks over the (more important) skip notice.
  async function runBulk(action: string, extra: Record<string, unknown> = {}, onSuccess?: (affected: number) => string) {
    if (selected.size === 0) return;
    setBulkBusy(true);
    setNotice(null);
    setSuccessNotice(null);
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
    const body: { affected?: number; skipped?: { id: string; name: string; reason: string }[] } = await response.json().catch(() => ({}));
    if (body.skipped && body.skipped.length > 0) {
      const count = body.skipped.length;
      const names = body.skipped.map((s) => s.name).join(", ");
      setNotice(`${count} product${count === 1 ? "" : "s"} skipped (${body.skipped[0].reason}): ${names}`);
    } else if (onSuccess) {
      setSuccessNotice(onSuccess(body.affected ?? selected.size));
    }
    setSelected(new Set());
    load();
  }

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
          placeholder="Search by name, slug, or tag…"
          className="w-64 rounded-xl border border-border p-2 text-sm"
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="rounded-xl border border-border p-2 text-sm">
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
            <button
              disabled={!canPublish || bulkBusy}
              onClick={() => runBulk("publish", {}, (n) => `${n} product${n === 1 ? "" : "s"} published.`)}
              className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              Publish
            </button>
          </span>
          <button
            disabled={bulkBusy}
            onClick={() => {
              // F-189: archiving ran instantly, with nothing beyond the
              // selection silently clearing to say it happened.
              if (!confirm(`Archive ${selected.size} product${selected.size === 1 ? "" : "s"}?`)) return;
              runBulk("archive", {}, (n) => `${n} product${n === 1 ? "" : "s"} archived.`);
            }}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
          >
            Archive
          </button>
          <button
            disabled={bulkBusy}
            onClick={() => {
              // F-174/F-189: `prompt()` returns `null` on Cancel, and
              // Number(null) is 0 — the old `Number(prompt(...))` read
              // straight into the request with no null/blank check, so
              // cancelling this dialog (or clicking OK on its own
              // pre-filled "0") sent `percent: 0`. That specific case is
              // harmless here only because of the `pct !== 0` guard below;
              // the sibling "Set stock" prompt had no such guard at all
              // (see the fix there) and zeroed every selected product's
              // stock the same way. Guard both the same way regardless.
              const raw = prompt("Adjust price by what percent? (e.g. -10 for -10%)", "");
              if (raw === null) return;
              const trimmed = raw.trim();
              if (trimmed === "") return;
              const pct = Number(trimmed);
              if (Number.isNaN(pct) || pct === 0) return;
              runBulk("adjust-price-pct", { percent: pct }, (n) => `Price adjusted for ${n} product${n === 1 ? "" : "s"}.`);
            }}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
          >
            Adjust price %
          </button>
          <button
            disabled={bulkBusy}
            onClick={() => {
              // F-174 (P1): cancelling this dialog used to zero every
              // selected product's stock. `prompt()` returns `null` on
              // Cancel; `Number(null)` — and Number('') for a blank
              // answer — is `0`, and the old guard
              // (`!Number.isNaN(stock) && stock >= 0`) let that `0`
              // straight through to runBulk. The prompt's own pre-filled
              // "0" meant even pressing Enter by reflex did the same.
              const raw = prompt("Set stock to what value for all variants?", "");
              if (raw === null) return; // Cancel
              const trimmed = raw.trim();
              if (trimmed === "") return; // blank answer
              const stock = Number(trimmed);
              if (!Number.isInteger(stock) || stock < 0) {
                setNotice("Stock must be a whole number ≥ 0.");
                return;
              }
              if (
                !confirm(
                  `Set stock to ${stock} for every variant of ${selected.size} product${selected.size === 1 ? "" : "s"}? This overwrites current stock.`,
                )
              )
                return;
              runBulk("set-stock", { stock }, (n) => `Stock set to ${stock} for ${n} product${n === 1 ? "" : "s"}.`);
            }}
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
          >
            Set stock
          </button>
          <select
            onChange={(e) => {
              const targetId = e.target.value;
              e.target.value = "";
              if (!targetId) return;
              // F-189: moving products ran instantly with no confirmation
              // and no success feedback either.
              const targetName = categoryOptions.find((c) => c.id === targetId)?.name ?? "that category";
              if (!confirm(`Move ${selected.size} product${selected.size === 1 ? "" : "s"} to "${targetName}"?`)) return;
              runBulk("move-category", { categoryId: targetId }, (n) => `${n} product${n === 1 ? "" : "s"} moved to "${targetName}".`);
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
      {successNotice ? <p className="text-xs font-medium text-green-700">{successNotice}</p> : null}

      {/* F-05 (docs/audit-2026-09-19/admin-ux.md) originally put this
          switch at `lg` (1024px) — the same breakpoint the sidebar itself
          collapses to a hamburger at (see admin-shell.tsx) — reasoning that
          a stacked card layout should take over for exactly the range
          where the persistent sidebar is already gone. That covered the
          audited phone/tablet-portrait widths (390×844 and 768×1024), but
          missed tablet *landscape*: at 1024–1279px (an iPad in landscape,
          or any 1024x768 touch viewport) the sidebar is already gone, yet
          this table's min-w-[900px] still didn't fit the remaining width,
          pushing Stock, Status and Edit off-screen behind an
          easy-to-miss horizontal scrollbar (F-332). `xl` (1280px) is the
          first width this table actually has room for every column at. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border xl:block">
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

      {/* Mobile/tablet stacked-card layout (below `xl` — see the F-332 fix
          comment above) — mirrors the table's own columns and every action
          (checkbox select, Edit link) so nothing needs horizontal
          scrolling to reach. */}
      <div className="space-y-3 xl:hidden">
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
