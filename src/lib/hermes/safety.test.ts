import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dispatchHermesTask, getHermesMode } from "@/lib/hermes/client";

describe("Hermes safety", () => {
  it("defaults to SUGGEST_ONLY mode", () => {
    assert.equal(getHermesMode(), "SUGGEST_ONLY");
  });

  it("returns stub output when runtime is not configured", async () => {
    const response = await dispatchHermesTask({ type: "seo_scan" });
    assert.equal(response.ok, true);
    assert.equal(response.stub, true);
    assert.ok(response.output?.includes("approval"));
  });
});
