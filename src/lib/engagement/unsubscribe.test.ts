import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidUnsubscribeToken } from "@/lib/engagement/unsubscribe";

describe("isValidUnsubscribeToken", () => {
  it("accepts a well-formed cuid-shaped token", () => {
    assert.equal(isValidUnsubscribeToken("cm2xg8f9v0000p4oh1a2b3c4d"), true);
  });

  it("rejects a token that doesn't start with 'c'", () => {
    assert.equal(isValidUnsubscribeToken("xm2xg8f9v0000p4oh1a2b3c4d"), false);
  });

  it("rejects a token that's the wrong length", () => {
    assert.equal(isValidUnsubscribeToken("cshort"), false);
    assert.equal(isValidUnsubscribeToken("c" + "a".repeat(30)), false);
  });

  it("rejects uppercase or non-alphanumeric characters", () => {
    assert.equal(isValidUnsubscribeToken("cM2XG8F9V0000P4OH1A2B3C4D"), false);
    assert.equal(isValidUnsubscribeToken("c-2xg8f9v0000p4oh1a2b3c4d"), false);
    assert.equal(isValidUnsubscribeToken("c<script>0000p4oh1a2b3c4"), false);
  });

  it("rejects non-string and empty input without throwing", () => {
    assert.equal(isValidUnsubscribeToken(""), false);
    assert.equal(isValidUnsubscribeToken(undefined), false);
    assert.equal(isValidUnsubscribeToken(null), false);
    assert.equal(isValidUnsubscribeToken(12345), false);
  });
});
