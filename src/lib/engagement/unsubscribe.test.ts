import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidUnsubscribeToken } from "@/lib/engagement/unsubscribe";
import { classifyUnsubscribeResponse } from "@/lib/engagement/unsubscribe-response";

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

// F-055: the /unsubscribe page told a shopper with a dead link "Something went
// wrong. Please try again." — a permanent 400 can never succeed on retry.
describe("classifyUnsubscribeResponse", () => {
  it("treats any 2xx as unsubscribed", () => {
    assert.equal(classifyUnsubscribeResponse(200), "done");
    assert.equal(classifyUnsubscribeResponse(204), "done");
  });

  it("calls a 400 an invalid link, which is not retryable", () => {
    assert.equal(classifyUnsubscribeResponse(400), "invalid-link");
  });

  it("separates a rate limit from a server fault", () => {
    assert.equal(classifyUnsubscribeResponse(429), "rate-limited");
    assert.equal(classifyUnsubscribeResponse(500), "error");
    assert.equal(classifyUnsubscribeResponse(503), "error");
  });
});
