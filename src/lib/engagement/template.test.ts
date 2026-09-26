import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { autoLinkUrls, buildEngagementVars, extractFirstName, renderTemplate } from "@/lib/engagement/template";

describe("engagement template", () => {
  it("renders variable placeholders", () => {
    const output = renderTemplate("Hi {{first_name}}, shop at {{shop_url}}", {
      first_name: "Priya",
      shop_url: "https://example.com/shop",
    });
    assert.equal(output, "Hi Priya, shop at https://example.com/shop");
  });

  it("builds default engagement vars", () => {
    const vars = buildEngagementVars({
      email: "doctor@hospital.in",
      contactName: "Dr. Priya Rao",
      organization: "City Hospital",
    });
    assert.equal(vars.first_name, "Dr.");
    assert.equal(vars.contact_name, "Dr. Priya Rao");
    assert.equal(vars.organization, "City Hospital");
    assert.match(String(vars.shop_url), /^https?:\/\//);
  });

  describe("F-270: name fallback and link fixes", () => {
    it("extractFirstName falls back to 'there', never to an email local part", () => {
      assert.equal(extractFirstName(undefined), "there");
      assert.equal(extractFirstName(""), "there");
      assert.equal(extractFirstName("Dr. Priya Rao"), "Dr.");
    });

    it("buildEngagementVars defaults first_name to 'there' for a subscriber with no name on file — not their email local part", () => {
      const vars = buildEngagementVars({ email: "dr.priya.k1987@example.com" });
      assert.equal(vars.first_name, "there");
    });

    it("buildEngagementVars strips a trailing slash from the site URL, avoiding '//shop'", () => {
      const vars = buildEngagementVars({ shopUrl: "https://shop.example.com/" });
      assert.equal(vars.shop_url, "https://shop.example.com");
      const rendered = renderTemplate("Shop now: {{shop_url}}/shop", vars);
      assert.equal(rendered, "Shop now: https://shop.example.com/shop");
    });

    it("autoLinkUrls turns a bare http(s) URL into a clickable link", () => {
      assert.equal(
        autoLinkUrls("Complete your order: https://shop.example.com/cart/123"),
        'Complete your order: <a href="https://shop.example.com/cart/123">https://shop.example.com/cart/123</a>',
      );
    });

    it("autoLinkUrls does not swallow trailing punctuation into the link", () => {
      assert.equal(
        autoLinkUrls("See https://example.com/a, then https://example.com/b."),
        'See <a href="https://example.com/a">https://example.com/a</a>, then <a href="https://example.com/b">https://example.com/b</a>.',
      );
    });
  });

  describe("HTML escaping (escapeHtml option)", () => {
    it("does not escape by default, preserving existing behavior", () => {
      const output = renderTemplate("Hi {{first_name}}", { first_name: "<b>Bold</b>" });
      assert.equal(output, "Hi <b>Bold</b>");
    });

    it("escapes <, >, and & in substituted values when escapeHtml is true", () => {
      const output = renderTemplate(
        "Hi {{first_name}} from {{organization}}",
        { first_name: "<script>alert(1)</script>", organization: "A & B <Corp>" },
        { escapeHtml: true },
      );
      assert.equal(
        output,
        "Hi &lt;script&gt;alert(1)&lt;/script&gt; from A &amp; B &lt;Corp&gt;",
      );
    });

    it("leaves the template's own static HTML markup untouched", () => {
      const output = renderTemplate(
        "<p>Hi {{first_name}}, <a href='{{shop_url}}'>shop now</a></p>",
        { first_name: "O'Brien & Co", shop_url: "https://example.com/shop?a=1&b=2" },
        { escapeHtml: true },
      );
      assert.equal(
        output,
        "<p>Hi O'Brien &amp; Co, <a href='https://example.com/shop?a=1&amp;b=2'>shop now</a></p>",
      );
    });

    it("escapes an empty/missing variable to an empty string either way", () => {
      const output = renderTemplate("Hi {{missing}}", {}, { escapeHtml: true });
      assert.equal(output, "Hi ");
    });
  });
});
