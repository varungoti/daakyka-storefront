import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, htmlToText } from "@/lib/email/html";

describe("escapeHtml (F-029, F-041)", () => {
  it("escapes everything that can break out of text or a quoted attribute", () => {
    assert.equal(escapeHtml(`<script>alert("x")</script> & 'y'`), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;");
  });

  it("leaves ordinary text alone", () => {
    assert.equal(escapeHtml("Scrub Top (M / Navy) - ₹1,198.00"), "Scrub Top (M / Navy) - ₹1,198.00");
  });
});

describe("htmlToText (F-041)", () => {
  it("keeps the destination of every link instead of dropping it", () => {
    const html = `<p>We received a request to reset your password.</p><p><a href="https://shop.test/account/reset-password?token=abc">Reset password</a></p><p>This link expires in 1 hour.</p>`;
    const text = htmlToText(html);
    assert.match(text, /Reset password \(https:\/\/shop\.test\/account\/reset-password\?token=abc\)/);
  });

  it("does not run sentences and buttons together (the old tag-strip produced 'password.Reset passwordThis link')", () => {
    const text = htmlToText(`<p>First sentence.</p><p>Second sentence.</p>`);
    assert.equal(text, "First sentence.\nSecond sentence.");
  });

  it("prints a bare URL once when the link text already is the URL", () => {
    assert.equal(htmlToText(`<a href="https://shop.test/x">https://shop.test/x</a>`), "https://shop.test/x");
  });

  it("decodes entities, honours <br>, and drops <style>/<head> content", () => {
    const text = htmlToText(
      `<html><head><title>Ignored</title><style>.a{color:red}</style></head><body><p>Tom &amp; Jerry&rsquo;s<br>Line two &mdash; done</p></body></html>`,
    );
    assert.equal(text, "Tom & Jerry’s\nLine two — done");
  });

  it("renders list items as dashes and table cells apart", () => {
    const text = htmlToText(`<ul><li>One</li><li>Two</li></ul><table><tr><td>Total</td><td>₹10.00</td></tr></table>`);
    assert.ok(text.includes("- One\n- Two"));
    assert.ok(/Total\s+₹10\.00/.test(text));
  });

  it("ignores in-page anchors and keeps only their label", () => {
    assert.equal(htmlToText(`<a href="#top">Back to top</a>`), "Back to top");
  });
});
