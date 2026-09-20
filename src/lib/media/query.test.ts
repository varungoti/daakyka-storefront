import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMediaAssetWhere,
  InvalidMediaQueryError,
  MEDIA_ASSET_DEFAULT_LIMIT,
  MEDIA_ASSET_MAX_LIMIT,
  parseMediaAssetQuery,
} from "@/lib/media/query";

describe("parseMediaAssetQuery", () => {
  it("defaults limit/offset and leaves everything else undefined for an empty request", () => {
    const parsed = parseMediaAssetQuery({});
    assert.equal(parsed.usage, undefined);
    assert.equal(parsed.source, undefined);
    assert.equal(parsed.search, undefined);
    assert.equal(parsed.from, undefined);
    assert.equal(parsed.to, undefined);
    assert.equal(parsed.limit, MEDIA_ASSET_DEFAULT_LIMIT);
    assert.equal(parsed.offset, 0);
  });

  it("accepts a valid usage and source", () => {
    const parsed = parseMediaAssetQuery({ usage: "PRODUCT", source: "AI" });
    assert.equal(parsed.usage, "PRODUCT");
    assert.equal(parsed.source, "AI");
  });

  it("rejects an unknown usage", () => {
    assert.throws(() => parseMediaAssetQuery({ usage: "NOT_A_USAGE" }), InvalidMediaQueryError);
  });

  it("rejects an unknown source", () => {
    assert.throws(() => parseMediaAssetQuery({ source: "SCANNER" }), InvalidMediaQueryError);
  });

  it("trims and caps the search term, and drops a blank one", () => {
    assert.equal(parseMediaAssetQuery({ search: "  navy scrub  " }).search, "navy scrub");
    assert.equal(parseMediaAssetQuery({ search: "   " }).search, undefined);
    const long = "a".repeat(500);
    assert.equal(parseMediaAssetQuery({ search: long }).search?.length, 200);
  });

  it("parses valid from/to dates", () => {
    const parsed = parseMediaAssetQuery({ from: "2026-01-01", to: "2026-06-01" });
    assert.equal(parsed.from?.toISOString().startsWith("2026-01-01"), true);
    assert.equal(parsed.to?.toISOString().startsWith("2026-06-01"), true);
  });

  it("rejects an unparsable date", () => {
    assert.throws(() => parseMediaAssetQuery({ from: "not-a-date" }), InvalidMediaQueryError);
  });

  it("rejects a from that is after to", () => {
    assert.throws(() => parseMediaAssetQuery({ from: "2026-06-01", to: "2026-01-01" }), InvalidMediaQueryError);
  });

  it("clamps limit to the maximum and ignores a non-positive value", () => {
    assert.equal(parseMediaAssetQuery({ limit: "9999" }).limit, MEDIA_ASSET_MAX_LIMIT);
    assert.equal(parseMediaAssetQuery({ limit: "0" }).limit, MEDIA_ASSET_DEFAULT_LIMIT);
    assert.equal(parseMediaAssetQuery({ limit: "-5" }).limit, MEDIA_ASSET_DEFAULT_LIMIT);
    assert.equal(parseMediaAssetQuery({ limit: "not-a-number" }).limit, MEDIA_ASSET_DEFAULT_LIMIT);
  });

  it("floors a fractional limit/offset and ignores a negative offset", () => {
    assert.equal(parseMediaAssetQuery({ limit: "10.9" }).limit, 10);
    assert.equal(parseMediaAssetQuery({ offset: "20.9" }).offset, 20);
    assert.equal(parseMediaAssetQuery({ offset: "-10" }).offset, 0);
  });
});

describe("buildMediaAssetWhere", () => {
  it("returns an empty where clause for an unfiltered query", () => {
    const where = buildMediaAssetWhere(parseMediaAssetQuery({}));
    assert.deepEqual(where, {});
  });

  it("filters by usage and source", () => {
    const where = buildMediaAssetWhere(parseMediaAssetQuery({ usage: "PRODUCT", source: "UPLOAD" }));
    assert.equal(where.usage, "PRODUCT");
    assert.equal(where.source, "UPLOAD");
  });

  it("builds a case-insensitive OR across alt/prompt/key for search", () => {
    const where = buildMediaAssetWhere(parseMediaAssetQuery({ search: "navy" }));
    assert.deepEqual(where.OR, [
      { alt: { contains: "navy", mode: "insensitive" } },
      { prompt: { contains: "navy", mode: "insensitive" } },
      { key: { contains: "navy", mode: "insensitive" } },
    ]);
  });

  it("builds a createdAt range from from/to", () => {
    const where = buildMediaAssetWhere(parseMediaAssetQuery({ from: "2026-01-01", to: "2026-02-01" }));
    assert.ok(where.createdAt && typeof where.createdAt === "object");
    const range = where.createdAt as { gte?: Date; lte?: Date };
    assert.equal(range.gte?.toISOString().startsWith("2026-01-01"), true);
    assert.equal(range.lte?.toISOString().startsWith("2026-02-01"), true);
  });

  it("builds an open-ended range when only from is given", () => {
    const where = buildMediaAssetWhere(parseMediaAssetQuery({ from: "2026-01-01" }));
    const range = where.createdAt as { gte?: Date; lte?: Date };
    assert.ok(range.gte);
    assert.equal(range.lte, undefined);
  });

  it("combines usage, source, search, and date range together", () => {
    const where = buildMediaAssetWhere(
      parseMediaAssetQuery({ usage: "PRODUCT", source: "AI", search: "scrub", from: "2026-01-01" }),
    );
    assert.equal(where.usage, "PRODUCT");
    assert.equal(where.source, "AI");
    assert.ok(Array.isArray(where.OR));
    assert.ok(where.createdAt);
  });
});
