import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OFFERS_CACHE_TAG, OfferNotFoundError, revalidateOffersCache } from "@/lib/offers/index";

describe("revalidateOffersCache", () => {
  // F-214: "max" is stale-while-revalidate, so the owner's first reload after
  // Save still showed the old content. { expire: 0 } forces a fresh read.
  it("invokes the revalidate function with the offers tag and an immediate ({ expire: 0 }) profile", () => {
    const calls: Array<[string, string | { expire?: number }]> = [];
    revalidateOffersCache((tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [[OFFERS_CACHE_TAG, { expire: 0 }]]);
  });

  it("swallows an error thrown by the revalidate function instead of throwing", () => {
    assert.doesNotThrow(() => {
      revalidateOffersCache(() => {
        throw new Error("no static generation store in this context");
      });
    });
  });

  it("defaults to the real next/cache revalidateTag and still doesn't throw outside a Next request scope", () => {
    assert.doesNotThrow(() => {
      revalidateOffersCache();
    });
  });
});

describe("OfferNotFoundError", () => {
  it("carries the offending id in its message", () => {
    const error = new OfferNotFoundError("offer_123");
    assert.equal(error.name, "OfferNotFoundError");
    assert.match(error.message, /offer_123/);
  });
});
