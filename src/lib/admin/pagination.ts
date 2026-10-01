import { z } from "zod";

/**
 * F-168/F-167/F-201: the notifications, audit-log and contact-enquiry admin
 * pages all grew past what one screen can show (2,000+ notifications,
 * 30,000+ audit rows, hundreds of enquiries) while each one capped or
 * hand-rolled its own paging. These helpers are the shared, plain-function
 * (no React, no Prisma — so they're unit-testable directly) core for
 * server-rendered `?page=N` pagination: parse the raw query param, turn a
 * total + page into the skip/take window, and build the links a pager
 * renders.
 */

/** `page` is a user-controlled URL query param — Zod per this repo's "Zod
 * for any new input" convention. `.catch(1)` rather than throwing: an
 * out-of-range or garbage page number is cosmetic here, not a security
 * concern, so it falls back to page 1 instead of erroring the page. */
const pageParamSchema = z.coerce.number().int().min(1).max(100_000).catch(1);

/** Next 16 hands `searchParams` values over as `string | string[] |
 * undefined` — a repeated `?page=2&page=3` arrives as an array. */
export type RawSearchParam = string | string[] | undefined;

export function firstParam(raw: RawSearchParam): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parsePageParam(raw: RawSearchParam): number {
  return pageParamSchema.parse(firstParam(raw));
}

export interface PageWindow {
  /** The page actually being shown — the requested one, clamped into
   * `1..totalPages` so `?page=9999` lands on the last page rather than an
   * empty list. */
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  skip: number;
  take: number;
}

export function getPageWindow(requestedPage: number, total: number, pageSize: number): PageWindow {
  const safeTotal = Math.max(0, Math.floor(total));
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage)), totalPages);
  return { page, pageSize, total: safeTotal, totalPages, skip: (page - 1) * pageSize, take: pageSize };
}

/** `/admin/x?filter=unread&page=3` from a base path and a params bag.
 * Empty/undefined values are dropped, and `page=1` is omitted so the
 * canonical first-page URL stays clean. */
export function adminListHref(
  basePath: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "page" && Number(value) <= 1) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}
