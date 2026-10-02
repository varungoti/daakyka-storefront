import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { humanizeHermesLabel } from "@/lib/hermes/labels";

describe("humanizeHermesLabel", () => {
  it("turns snake_case task and approval types into sentence case", () => {
    assert.equal(humanizeHermesLabel("daily_seo_health_scan"), "Daily SEO health scan");
    assert.equal(humanizeHermesLabel("weekly_competitor_scan"), "Weekly competitor scan");
    assert.equal(humanizeHermesLabel("blog_draft"), "Blog draft");
    assert.equal(humanizeHermesLabel("campaign_draft"), "Campaign draft");
  });

  it("turns SCREAMING_CASE modes and statuses into sentence case", () => {
    assert.equal(humanizeHermesLabel("SUGGEST_ONLY"), "Suggest only");
    assert.equal(humanizeHermesLabel("PENDING"), "Pending");
    assert.equal(humanizeHermesLabel("COMPLETED"), "Completed");
  });

  it("keeps acronyms upper-case even at the start of the label", () => {
    assert.equal(humanizeHermesLabel("seo_audit"), "SEO audit");
  });

  it("never prints a raw identifier: no underscores survive, blanks stay blank", () => {
    assert.ok(!humanizeHermesLabel("a_b__c-d").includes("_"));
    assert.equal(humanizeHermesLabel("a_b__c-d"), "A b c d");
    assert.equal(humanizeHermesLabel(""), "");
    assert.equal(humanizeHermesLabel("  _ "), "");
  });
});
