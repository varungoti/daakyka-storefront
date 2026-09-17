import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEngagementVars, renderTemplate } from "@/lib/engagement/template";

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
