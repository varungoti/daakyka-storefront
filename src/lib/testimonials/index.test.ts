import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TESTIMONIALS_CACHE_TAG,
  TestimonialNotFoundError,
  revalidateTestimonialsCache,
} from "@/lib/testimonials/index";

describe("revalidateTestimonialsCache", () => {
  it("invokes the revalidate function with the testimonials tag and the 'max' profile", () => {
    const calls: Array<[string, string]> = [];
    revalidateTestimonialsCache((tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [[TESTIMONIALS_CACHE_TAG, "max"]]);
  });

  it("swallows an error thrown by the revalidate function instead of throwing", () => {
    assert.doesNotThrow(() => {
      revalidateTestimonialsCache(() => {
        throw new Error("no static generation store in this context");
      });
    });
  });

  it("defaults to the real next/cache revalidateTag and still doesn't throw outside a Next request scope", () => {
    assert.doesNotThrow(() => {
      revalidateTestimonialsCache();
    });
  });
});

describe("TestimonialNotFoundError", () => {
  it("carries the offending id in its message", () => {
    const error = new TestimonialNotFoundError("testimonial_123");
    assert.equal(error.name, "TestimonialNotFoundError");
    assert.match(error.message, /testimonial_123/);
  });
});
