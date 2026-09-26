import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAuthorized } from "./auth.js";

describe("isAuthorized (F-306)", () => {
  it("rejects every request when no key is configured (fail closed)", () => {
    assert.equal(isAuthorized("Bearer anything", undefined), false);
    assert.equal(isAuthorized(undefined, undefined), false);
  });

  it("rejects a missing Authorization header when a key is configured", () => {
    assert.equal(isAuthorized(undefined, "secret-key"), false);
  });

  it("rejects a header that isn't a Bearer token", () => {
    assert.equal(isAuthorized("Basic secret-key", "secret-key"), false);
  });

  it("rejects the wrong key", () => {
    assert.equal(isAuthorized("Bearer wrong-key", "secret-key"), false);
  });

  it("rejects a key of a different length without throwing", () => {
    assert.doesNotThrow(() => isAuthorized("Bearer short", "a-much-longer-secret-key"));
    assert.equal(isAuthorized("Bearer short", "a-much-longer-secret-key"), false);
  });

  it("accepts the correct key", () => {
    assert.equal(isAuthorized("Bearer secret-key", "secret-key"), true);
  });
});
