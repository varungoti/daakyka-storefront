import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retryAfterMessage } from "@/lib/security/retry-after";

function responseWithRetryAfter(value: string | null): Response {
  const headers = new Headers();
  if (value !== null) headers.set("Retry-After", value);
  return new Response(null, { status: 429, headers });
}

describe("retryAfterMessage (F-323/F-324)", () => {
  it("includes the exact wait time when Retry-After is a positive integer", () => {
    assert.equal(
      retryAfterMessage(responseWithRetryAfter("42")),
      "Too many attempts from this network. Please wait 42 seconds and try again.",
    );
  });

  it("uses singular 'second' for a 1-second Retry-After", () => {
    assert.equal(
      retryAfterMessage(responseWithRetryAfter("1")),
      "Too many attempts from this network. Please wait 1 second and try again.",
    );
  });

  it("falls back to a generic wait message when Retry-After is missing", () => {
    assert.equal(
      retryAfterMessage(responseWithRetryAfter(null)),
      "Too many attempts from this network. Please wait a moment and try again.",
    );
  });

  it("falls back to a generic wait message when Retry-After is not a positive number", () => {
    assert.equal(
      retryAfterMessage(responseWithRetryAfter("not-a-number")),
      "Too many attempts from this network. Please wait a moment and try again.",
    );
    assert.equal(
      retryAfterMessage(responseWithRetryAfter("0")),
      "Too many attempts from this network. Please wait a moment and try again.",
    );
    assert.equal(
      retryAfterMessage(responseWithRetryAfter("-5")),
      "Too many attempts from this network. Please wait a moment and try again.",
    );
  });

  it("accepts a custom subject noun", () => {
    assert.equal(
      retryAfterMessage(responseWithRetryAfter("10"), "uploads"),
      "Too many uploads from this network. Please wait 10 seconds and try again.",
    );
  });
});
