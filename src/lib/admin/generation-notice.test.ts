import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generationFailureNotice } from "@/lib/admin/generation-notice";

// F-292: a Content Editor (media:manage, no ai:generate) clicking "Generate
// with AI" got a 403 and the same "Generation failed — try again" line as
// any transient error — a retry that could never work.

describe("generationFailureNotice", () => {
  it("a 403 from the permission check says the role can't generate — not 'try again'", () => {
    const notice = generationFailureNotice(403, "Forbidden");
    assert.match(notice, /role/i);
    assert.match(notice, /upload/i);
    assert.doesNotMatch(notice, /try again/i);
  });

  it("a 403 with no body is treated the same way", () => {
    assert.equal(generationFailureNotice(403), generationFailureNotice(403, "Forbidden"));
    assert.equal(generationFailureNotice(403, undefined), generationFailureNotice(403, "  "));
  });

  it("a 403 from the route itself (a slot that must stay a real photo) shows the route's own message", () => {
    assert.equal(
      generationFailureNotice(403, "Slot about.founder must be a real photograph"),
      "Slot about.founder must be a real photograph",
    );
  });

  it("keeps the existing not-configured and daily-limit messages", () => {
    assert.match(generationFailureNotice(503), /OPENAI_API_KEY/);
    assert.match(generationFailureNotice(429), /Daily AI image limit/);
  });

  it("anything else is still the generic retryable failure", () => {
    for (const status of [400, 500, 502]) {
      assert.match(generationFailureNotice(status), /try again/i);
    }
  });
});
