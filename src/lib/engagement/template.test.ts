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
});
