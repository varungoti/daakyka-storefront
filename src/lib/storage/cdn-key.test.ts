import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCdnObjectKey } from "@/lib/storage/cdn-key";

/**
 * F5 (docs/audit-2026-09-19/security.md): /cdn/[...key] used to run its
 * ".."/"." guard BEFORE a second decodeURIComponent() pass, so a
 * double-encoded ".." passed the guard as the harmless-looking literal
 * string "%2e%2e" and only became ".." once the unchecked second decode
 * ran afterward. These tests operate on resolveCdnObjectKey() with
 * inputs shaped like what Next.js's router hands the route handler —
 * i.e. already decoded ONCE — so a raw URL segment of `%252e%252e`
 * arrives here as the string "%2e%2e" (Next's own decode turned "%25"
 * into "%", leaving the rest untouched).
 */
describe("resolveCdnObjectKey", () => {
  it("joins ordinary multi-segment keys in order", () => {
    assert.equal(
      resolveCdnObjectKey(["media", "products", "2026", "09", "abc-123.webp"]),
      "media/products/2026/09/abc-123.webp",
    );
  });

  it("decodes a legitimately percent-encoded segment (e.g. a literal space)", () => {
    assert.equal(resolveCdnObjectKey(["my%20file.png"]), "my file.png");
  });

  it("rejects an empty segment list", () => {
    assert.equal(resolveCdnObjectKey([]), null);
  });

  it("rejects a single-encoded '..' segment (arrives here as the literal string '..')", () => {
    assert.equal(resolveCdnObjectKey([".."]), null);
  });

  it("rejects a single-encoded '.' segment", () => {
    assert.equal(resolveCdnObjectKey(["."]), null);
  });

  it("rejects an empty-string segment", () => {
    assert.equal(resolveCdnObjectKey(["media", "", "abc.png"]), null);
  });

  it("F5 regression: rejects a DOUBLE-encoded '..' that only becomes '..' after this module's own decode", () => {
    // A raw URL segment of "%252e%252e" is decoded ONCE by Next's router
    // (which this test simulates by starting from "%2e%2e", not the raw
    // "%252e%252e") before it ever reaches resolveCdnObjectKey(). The
    // old code checked this pre-decode string against ".." (a miss, so
    // it passed) and only decoded — and rejected too late — afterward.
    assert.equal(resolveCdnObjectKey(["%2e%2e"]), null);
    // A mixed traversal segment among otherwise-normal ones must also
    // reject the whole key, not just be skipped.
    assert.equal(resolveCdnObjectKey(["media", "%2e%2e", "abc.png"]), null);
  });

  it("F5 regression: rejects a double-encoded '/' that would otherwise smuggle a new path separator into one segment", () => {
    // Raw "%252f" -> Next's decode -> "%2f" -> this module's decode -> "/".
    // A single array element must never be allowed to expand into
    // multiple path components after decoding.
    assert.equal(resolveCdnObjectKey(["foo%2fbar"]), null);
  });

  it("rejects a segment containing a literal backslash", () => {
    assert.equal(resolveCdnObjectKey(["foo\\bar"]), null);
    assert.equal(resolveCdnObjectKey(["foo%5cbar"]), null);
  });

  it("rejects a segment that merely CONTAINS '..' even if not an exact match", () => {
    assert.equal(resolveCdnObjectKey(["foo..bar"]), null);
    assert.equal(resolveCdnObjectKey(["..foo"]), null);
    assert.equal(resolveCdnObjectKey(["foo.."]), null);
  });

  it("rejects malformed percent-encoding instead of throwing", () => {
    assert.doesNotThrow(() => resolveCdnObjectKey(["100%off"]));
    assert.equal(resolveCdnObjectKey(["100%off"]), null);
  });
});
