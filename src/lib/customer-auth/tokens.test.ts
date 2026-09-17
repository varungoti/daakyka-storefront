import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateRawToken, hashToken } from "@/lib/customer-auth/tokens";

/** Pure round-trip checks for the token generation/hashing helpers, with
 * no DB involved (the DB-dependent issue/consume/mark-used flow is
 * exercised in tests/integration/customer-auth.test.ts). */
describe("customer-auth tokens", () => {
  it("generates a URL-safe token with sufficient entropy", () => {
    const token = generateRawToken();
    // base64url of 32 random bytes is 43 chars (no padding).
    assert.equal(token.length, 43);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });

  it("generates a different token on every call", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    assert.notEqual(a, b);
  });

  it("hashes deterministically (same input -> same hash)", () => {
    const token = generateRawToken();
    assert.equal(hashToken(token), hashToken(token));
  });

  it("hashes different tokens to different values", () => {
    const a = generateRawToken();
    const b = generateRawToken();
    assert.notEqual(hashToken(a), hashToken(b));
  });

  it("never stores/returns the raw token as its own hash", () => {
    const token = generateRawToken();
    assert.notEqual(hashToken(token), token);
  });

  it("produces a 64-character hex sha256 digest", () => {
    const hash = hashToken(generateRawToken());
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });
});
