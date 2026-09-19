import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HOMEPAGE_CACHE_TAG, revalidateHomepageCache } from "@/lib/homepage/index";

describe("revalidateHomepageCache", () => {
  it("invokes the revalidate function with the homepage tag and the 'max' profile", () => {
    const calls: Array<[string, string]> = [];
    revalidateHomepageCache((tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [[HOMEPAGE_CACHE_TAG, "max"]]);
  });

  it("swallows an error thrown by the revalidate function instead of throwing", () => {
    assert.doesNotThrow(() => {
      revalidateHomepageCache(() => {
        throw new Error("no static generation store in this context");
      });
    });
  });

  it("defaults to the real next/cache revalidateTag (throws outside a Next request scope, and that throw is caught)", () => {
    // No argument passed — exercises the real default. Outside an actual
    // Next.js server there's no static generation store, so the real
    // revalidateTag throws internally; revalidateHomepageCache must catch
    // it rather than let it propagate (this is what makes the function
    // safe to call from plain scripts/tests, per its own doc comment).
    assert.doesNotThrow(() => {
      revalidateHomepageCache();
    });
  });
});
