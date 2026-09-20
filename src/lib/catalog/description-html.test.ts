import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  descriptionToPlainText,
  descriptionToSafeHtml,
  looksLikeSanitizedHtml,
  prepareDescriptionForStorage,
  sanitizeDescriptionHtml,
} from "@/lib/catalog/description-html";

describe("looksLikeSanitizedHtml", () => {
  it("is true for text containing an allowlisted tag", () => {
    assert.equal(looksLikeSanitizedHtml("<p>Hello</p>"), true);
    assert.equal(looksLikeSanitizedHtml("Soft cotton.<br>Machine washable."), true);
  });

  it("is false for plain text, even text containing a literal '<'", () => {
    assert.equal(looksLikeSanitizedHtml("Soft cotton scrubs."), false);
    assert.equal(looksLikeSanitizedHtml("Sizes < XL run small"), false);
    assert.equal(looksLikeSanitizedHtml(""), false);
  });
});

describe("sanitizeDescriptionHtml — hostile input", () => {
  it("strips <script> tags and their content entirely", () => {
    const out = sanitizeDescriptionHtml("<p>Hello</p><script>alert(document.cookie)</script>");
    assert.equal(out.includes("script"), false);
    assert.equal(out.includes("alert"), false);
    assert.equal(out, "<p>Hello</p>");
  });

  it("strips <img> with an onerror handler", () => {
    const out = sanitizeDescriptionHtml('<p>Hi</p><img src="x" onerror="alert(1)">');
    assert.equal(out.includes("img"), false);
    assert.equal(out.includes("onerror"), false);
    assert.equal(out.includes("alert"), false);
  });

  it("strips javascript: URLs from links", () => {
    const out = sanitizeDescriptionHtml('<a href="javascript:alert(1)">click</a>');
    assert.equal(out.includes("javascript:"), false);
  });

  it("strips event-handler and style/class attributes from allowed tags", () => {
    const out = sanitizeDescriptionHtml('<p onclick="alert(1)" style="color:red" class="x">Hi</p>');
    assert.equal(out, "<p>Hi</p>");
  });

  it("strips iframe/object/embed and their content", () => {
    const out = sanitizeDescriptionHtml('<p>Hi</p><iframe src="https://evil.example"></iframe>');
    assert.equal(out, "<p>Hi</p>");
  });

  it("keeps a safe https link but forces rel/target", () => {
    const out = sanitizeDescriptionHtml('<a href="https://daakyka.com/size-guide">Size guide</a>');
    assert.match(out, /href="https:\/\/daakyka\.com\/size-guide"/);
    assert.match(out, /rel="noopener noreferrer nofollow"/);
    assert.match(out, /target="_blank"/);
  });

  it("keeps the allowlisted formatting tags", () => {
    const out = sanitizeDescriptionHtml("<p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>");
    assert.equal(out, "<p><strong>Bold</strong> and <em>italic</em></p><ul><li>One</li></ul>");
  });

  it("is idempotent — sanitizing already-sanitized output is a no-op", () => {
    const once = sanitizeDescriptionHtml("<p>Hi <strong>there</strong></p>");
    const twice = sanitizeDescriptionHtml(once);
    assert.equal(once, twice);
  });

  it("handles a nested/malformed tag-smuggling attempt without producing a script element", () => {
    // The malformed input can't be coaxed into a real executable <script>
    // element — whatever text remains (if any) is inert, escaped text
    // inside the allowed <p>, never inside a script/event-handler context.
    const out = sanitizeDescriptionHtml("<p>Hi<scr<script>ipt>alert(1)</scr</script>ipt></p>");
    assert.equal(out.toLowerCase().includes("<script"), false);
    assert.equal(out.toLowerCase().includes("</script"), false);
    assert.equal(out.startsWith("<p>") && out.endsWith("</p>"), true);
  });
});

describe("prepareDescriptionForStorage", () => {
  it("returns null for null/undefined/empty/whitespace-only input", () => {
    assert.equal(prepareDescriptionForStorage(null), null);
    assert.equal(prepareDescriptionForStorage(undefined), null);
    assert.equal(prepareDescriptionForStorage(""), null);
    assert.equal(prepareDescriptionForStorage("   "), null);
  });

  it("leaves legacy plain text completely unchanged (backward compatibility)", () => {
    const legacy = "Soft cotton scrub set.\n\nMachine washable up to 60 degrees. Fits true to size.";
    assert.equal(prepareDescriptionForStorage(legacy), legacy);
  });

  it("sanitizes HTML coming from the rich-text editor", () => {
    const fromEditor = '<p>Great fit</p><script>alert(1)</script>';
    assert.equal(prepareDescriptionForStorage(fromEditor), "<p>Great fit</p>");
  });

  it("trims surrounding whitespace on plain text", () => {
    assert.equal(prepareDescriptionForStorage("  Hello  "), "Hello");
  });
});

describe("descriptionToSafeHtml", () => {
  it("returns an empty string for null/undefined/empty", () => {
    assert.equal(descriptionToSafeHtml(null), "");
    assert.equal(descriptionToSafeHtml(undefined), "");
    assert.equal(descriptionToSafeHtml(""), "");
  });

  it("upgrades legacy plain text into escaped paragraph HTML", () => {
    const out = descriptionToSafeHtml("Line one.\nLine two.\n\nSecond paragraph.");
    assert.equal(out, "<p>Line one.<br>Line two.</p><p>Second paragraph.</p>");
  });

  it("HTML-escapes hostile content that was stored as legacy plain text", () => {
    // Pre-existing rows were never restricted to plain text by the old
    // schema — this proves a string like this can never execute even
    // though it predates the sanitizer.
    const out = descriptionToSafeHtml("<script>alert(1)</script>");
    assert.equal(out.includes("<script>"), false);
    assert.match(out, /&lt;script&gt;/);
  });

  it("re-sanitizes already-HTML values defensively", () => {
    const out = descriptionToSafeHtml('<p>Hi</p><img src=x onerror=alert(1)>');
    assert.equal(out, "<p>Hi</p>");
  });
});

describe("descriptionToPlainText", () => {
  it("returns an empty string for null/undefined/empty", () => {
    assert.equal(descriptionToPlainText(null), "");
    assert.equal(descriptionToPlainText(undefined), "");
  });

  it("collapses whitespace in legacy plain text", () => {
    assert.equal(descriptionToPlainText("Line one.\n\nLine  two."), "Line one. Line two.");
  });

  it("strips tags from sanitized HTML for meta/JSON-LD contexts", () => {
    assert.equal(descriptionToPlainText("<p>Soft <strong>cotton</strong> scrubs.</p><ul><li>Breathable</li></ul>"), "Soft cotton scrubs. Breathable");
  });
});
