import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeReadTime } from "@/lib/seo/read-time";

/**
 * release-hardening F-155: /blog/caring-for-performance-scrubs (3 sentences,
 * ~33 words) was hardcoded "4 min read" and /blog/how-to-choose-medical-
 * scrubs (~80 words) was hardcoded "6 min read" — both misleadingly long
 * for their real length.
 */
describe("computeReadTime", () => {
  it("never reports less than 1 minute for a short post", () => {
    assert.equal(computeReadTime(["A very short post."]), "1 min read");
  });

  it("matches the ~33-word caring-for-performance-scrubs fixture at 1 min, not the hardcoded 4", () => {
    const shortPost = [
      "Wash performance scrubs in cold water and skip the fabric softener.",
      "Line dry when possible to protect the stretch fibres.",
      "This keeps them fresh for long shifts.",
    ];
    assert.equal(computeReadTime(shortPost), "1 min read");
  });

  it("scales up for a longer post", () => {
    const longPost = Array.from({ length: 10 }, () => "word ".repeat(50));
    // 10 paragraphs * 50 words = 500 words -> ceil(500/200) = 3
    assert.equal(computeReadTime(longPost), "3 min read");
  });

  it("ignores extra whitespace between words", () => {
    assert.equal(computeReadTime(["one   two\tthree\n\nfour"]), "1 min read");
  });
});
