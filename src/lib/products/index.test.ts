import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTS_CACHE_TAG,
  productCacheTag,
  revalidateProductStockForVariants,
  revalidateProductStockTags,
} from "@/lib/products/index";

/**
 * release-hardening audit F-017: orders, payment verification and admin
 * cancel/restock all mutate stock but never invalidated the cached
 * catalog, so a PDP or listing could keep showing pre-mutation stock
 * indefinitely. revalidateProductStockTags is the exact-tags-and-profiles
 * half of the fix, split out (same pattern as
 * src/lib/homepage/index.ts's revalidateHomepageCache) so it's
 * unit-testable — next/cache's exports can't be spied on directly (see
 * that module's doc comment for why).
 */
describe("revalidateProductStockTags", () => {
  it("revalidates each product's own tag with { expire: 0 }, then the broad products tag with 'max'", () => {
    const calls: Array<[string, string | { expire: number }]> = [];
    revalidateProductStockTags(["a-line-school-skirt", "box-pleat-school-skirt"], (tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [
      [productCacheTag("a-line-school-skirt"), { expire: 0 }],
      [productCacheTag("box-pleat-school-skirt"), { expire: 0 }],
      [PRODUCTS_CACHE_TAG, "max"],
    ]);
  });

  it("de-duplicates slugs (one order can touch the same product's multiple variants)", () => {
    const calls: Array<[string, string | { expire: number }]> = [];
    revalidateProductStockTags(["wraparound-ot-gown", "wraparound-ot-gown"], (tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [
      [productCacheTag("wraparound-ot-gown"), { expire: 0 }],
      [PRODUCTS_CACHE_TAG, "max"],
    ]);
  });

  it("is a no-op for an empty slug list — never touches the broad tag either", () => {
    const calls: unknown[] = [];
    revalidateProductStockTags([], (...args) => calls.push(args));
    assert.deepEqual(calls, []);
  });

  it("swallows an error thrown by the injected revalidate function instead of throwing, and still calls the broad tag afterwards", () => {
    const calls: Array<[string, string | { expire: number }]> = [];
    assert.doesNotThrow(() => {
      revalidateProductStockTags(["classic-lab-coat"], (tag, profile) => {
        calls.push([tag, profile]);
        if (profile !== "max") throw new Error("no static generation store in this context");
      });
    });
    assert.deepEqual(calls, [
      [productCacheTag("classic-lab-coat"), { expire: 0 }],
      [PRODUCTS_CACHE_TAG, "max"],
    ]);
  });

  it("defaults to the real next/cache revalidateTag (throws outside a Next request scope, and that throw is caught)", () => {
    // No revalidate argument — exercises the real default. Outside an
    // actual Next.js server there's no static generation store, so the
    // real revalidateTag throws internally; this must not propagate, which
    // is what makes the function safe to call from an order/payment/cancel
    // code path that also runs in plain scripts and tests.
    assert.doesNotThrow(() => {
      revalidateProductStockTags(["classic-lab-coat"]);
    });
  });
});

describe("revalidateProductStockForVariants", () => {
  it("is a no-op for an empty variant id list (never queries the DB)", async () => {
    const calls: unknown[] = [];
    await assert.doesNotReject(
      revalidateProductStockForVariants([], (...args) => calls.push(args)),
    );
    assert.deepEqual(calls, []);
  });
});
