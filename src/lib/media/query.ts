import { MediaSource, MediaUsage, type Prisma } from "@/generated/prisma/client";

/**
 * F-07 (docs/audit-2026-09-19/admin-ux.md): query parsing/building for the
 * general-purpose media library browser (src/components/admin/
 * media-library-browser.tsx), used by `GET /api/admin/media`
 * (src/app/api/admin/media/route.ts). Split out as pure, DB-free functions
 * — same rationale as src/lib/catalog/product-validation.ts — so the
 * filtering/validation rules are unit-testable without a database, and so
 * the route handler itself stays a thin adapter (parse request -> query DB
 * -> shape response).
 */

export const MEDIA_ASSET_DEFAULT_LIMIT = 24;
export const MEDIA_ASSET_MAX_LIMIT = 60;
export const MEDIA_ASSET_MAX_SEARCH_LENGTH = 200;

const MEDIA_USAGE_VALUES = new Set<string>(Object.values(MediaUsage));
const MEDIA_SOURCE_VALUES = new Set<string>(Object.values(MediaSource));

export class InvalidMediaQueryError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "InvalidMediaQueryError";
    this.field = field;
  }
}

/** Raw query params exactly as they arrive from `URLSearchParams` — every
 * field is a string or null/undefined, matching what `url.searchParams.get`
 * returns, so the route handler can pass them straight through with no
 * marshalling of its own. */
export interface MediaAssetQueryParams {
  usage?: string | null;
  source?: string | null;
  search?: string | null;
  /** Inclusive lower bound on `createdAt`, as an ISO-8601 date/time string. */
  from?: string | null;
  /** Inclusive upper bound on `createdAt`, as an ISO-8601 date/time string. */
  to?: string | null;
  limit?: string | null;
  offset?: string | null;
}

export interface ParsedMediaAssetQuery {
  usage?: MediaUsage;
  source?: MediaSource;
  search?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

/** Validates and normalizes raw query params. Throws `InvalidMediaQueryError`
 * for anything the caller should turn into a 400 (unknown usage/source, an
 * unparsable date) — everything else (limit/offset out of range, a blank
 * search string) is clamped/dropped rather than rejected, since those are
 * just "the browser asked for something odd" rather than a real error. */
export function parseMediaAssetQuery(params: MediaAssetQueryParams): ParsedMediaAssetQuery {
  let usage: MediaUsage | undefined;
  if (params.usage) {
    if (!MEDIA_USAGE_VALUES.has(params.usage)) {
      throw new InvalidMediaQueryError("usage", `usage must be one of: ${[...MEDIA_USAGE_VALUES].join(", ")}`);
    }
    usage = params.usage as MediaUsage;
  }

  let source: MediaSource | undefined;
  if (params.source) {
    if (!MEDIA_SOURCE_VALUES.has(params.source)) {
      throw new InvalidMediaQueryError("source", `source must be one of: ${[...MEDIA_SOURCE_VALUES].join(", ")}`);
    }
    source = params.source as MediaSource;
  }

  const search = params.search?.trim().slice(0, MEDIA_ASSET_MAX_SEARCH_LENGTH) || undefined;

  const from = parseBoundaryDate(params.from, "from");
  const to = parseBoundaryDate(params.to, "to");
  if (from && to && from.getTime() > to.getTime()) {
    throw new InvalidMediaQueryError("from", "from must not be after to");
  }

  const limitNum = Number(params.limit);
  const limit = Number.isFinite(limitNum) && limitNum > 0 ? Math.min(Math.floor(limitNum), MEDIA_ASSET_MAX_LIMIT) : MEDIA_ASSET_DEFAULT_LIMIT;

  const offsetNum = Number(params.offset);
  const offset = Number.isFinite(offsetNum) && offsetNum > 0 ? Math.floor(offsetNum) : 0;

  return { usage, source, search, from, to, limit, offset };
}

function parseBoundaryDate(value: string | null | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidMediaQueryError(field, `${field} must be a valid date`);
  }
  return date;
}

/** Maps a parsed query into a Prisma `where` clause. Kept separate from
 * parsing above so each half is independently testable: parsing owns
 * "is this a valid request", this owns "what does that request mean as a
 * query". */
export function buildMediaAssetWhere(query: ParsedMediaAssetQuery): Prisma.MediaAssetWhereInput {
  const where: Prisma.MediaAssetWhereInput = {};
  if (query.usage) where.usage = query.usage;
  if (query.source) where.source = query.source;
  if (query.search) {
    where.OR = [
      { alt: { contains: query.search, mode: "insensitive" } },
      { prompt: { contains: query.search, mode: "insensitive" } },
      { key: { contains: query.search, mode: "insensitive" } },
    ];
  }
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    };
  }
  return where;
}
