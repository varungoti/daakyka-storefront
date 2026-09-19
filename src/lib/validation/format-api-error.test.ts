import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatApiError } from "@/lib/validation/format-api-error";

describe("formatApiError", () => {
  it("uses the single issue's own message as the summary and field error", () => {
    const result = formatApiError(
      { error: "Invalid request", issues: [{ path: ["price"], message: "Price must be greater than 0" }] },
      "Couldn't save.",
    );
    assert.equal(result.summary, "Price must be greater than 0");
    assert.deepEqual(result.fieldErrors, { price: "Price must be greater than 0" });
  });

  it("joins multiple issue messages into the summary and maps each by field", () => {
    const result = formatApiError(
      {
        error: "Invalid request",
        issues: [
          { path: ["name"], message: "Name is required" },
          { path: ["price"], message: "Price must be greater than 0" },
        ],
      },
      "Couldn't save.",
    );
    assert.equal(result.summary, "Name is required Price must be greater than 0");
    assert.deepEqual(result.fieldErrors, {
      name: "Name is required",
      price: "Price must be greater than 0",
    });
  });

  it("joins a nested path with '.' so it can key a nested field", () => {
    const result = formatApiError(
      { issues: [{ path: ["shippingAddress", "city"], message: "City is required" }] },
      "Couldn't save.",
    );
    assert.deepEqual(result.fieldErrors, { "shippingAddress.city": "City is required" });
  });

  it("keeps the first message when two issues share the same path", () => {
    const result = formatApiError(
      {
        issues: [
          { path: ["price"], message: "First message" },
          { path: ["price"], message: "Second message" },
        ],
      },
      "Couldn't save.",
    );
    assert.equal(result.fieldErrors.price, "First message");
  });

  it("falls back to the generic `error` string when there are no issues", () => {
    const result = formatApiError({ error: "Slug is already in use" }, "Couldn't save.");
    assert.equal(result.summary, "Slug is already in use");
    assert.deepEqual(result.fieldErrors, {});
  });

  it("falls back to the caller-provided fallback for an empty body", () => {
    assert.equal(formatApiError({}, "Couldn't save — check the fields above.").summary, "Couldn't save — check the fields above.");
  });

  it("falls back to the caller-provided fallback for a non-object body (e.g. a failed .json() parse)", () => {
    assert.equal(formatApiError(null, "Couldn't save.").summary, "Couldn't save.");
    assert.equal(formatApiError(undefined, "Couldn't save.").summary, "Couldn't save.");
    assert.equal(formatApiError("oops", "Couldn't save.").summary, "Couldn't save.");
  });

  it("ignores an issue with no path (e.g. a .strict() unrecognized-key error) for field errors but keeps it in the summary", () => {
    const result = formatApiError(
      { issues: [{ path: [], message: 'Unrecognized key: "foo"' }] },
      "Couldn't save.",
    );
    assert.equal(result.summary, 'Unrecognized key: "foo"');
    assert.deepEqual(result.fieldErrors, {});
  });

  it("ignores malformed issue entries instead of throwing", () => {
    const result = formatApiError(
      { issues: [null, {}, { path: ["price"] }, { message: 42 }, { path: ["price"], message: "Price must be greater than 0" }] },
      "Couldn't save.",
    );
    assert.equal(result.summary, "Price must be greater than 0");
    assert.deepEqual(result.fieldErrors, { price: "Price must be greater than 0" });
  });
});
