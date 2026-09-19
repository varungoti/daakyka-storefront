import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BLOG_CACHE_TAG, revalidateBlogCache } from "@/lib/blog/index";

describe("revalidateBlogCache", () => {
  it("invokes the revalidate function with the blog tag and the 'max' profile", () => {
    const calls: Array<[string, string]> = [];
    revalidateBlogCache((tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [[BLOG_CACHE_TAG, "max"]]);
  });

  it("swallows an error thrown by the revalidate function instead of throwing", () => {
    assert.doesNotThrow(() => {
      revalidateBlogCache(() => {
        throw new Error("no static generation store in this context");
      });
    });
  });

  it("defaults to the real next/cache revalidateTag and still doesn't throw outside a Next request scope", () => {
    assert.doesNotThrow(() => {
      revalidateBlogCache();
    });
  });
});
