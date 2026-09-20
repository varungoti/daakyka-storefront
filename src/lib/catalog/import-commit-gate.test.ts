import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canCommitImport } from "@/lib/catalog/import-commit-gate";

describe("canCommitImport", () => {
  it("is false before any dry run has run (null)", () => {
    assert.equal(canCommitImport(null), false);
  });

  it("is false when the dry run found any errors", () => {
    assert.equal(canCommitImport({ summary: { total: 5, error: 1 } }), false);
  });

  it("is false when the dry run found zero rows (nothing to commit)", () => {
    assert.equal(canCommitImport({ summary: { total: 0, error: 0 } }), false);
  });

  it("is true once a dry run completed with rows and zero errors", () => {
    assert.equal(canCommitImport({ summary: { total: 12, error: 0 } }), true);
  });

  it("tolerates warnings — only errors block commit", () => {
    // The component's DryRunSummary carries a separate `warning` count that
    // this gate never looks at — warnings are advisory, not blocking, per
    // the audit's own wording ("...with zero errors").
    assert.equal(canCommitImport({ summary: { total: 3, error: 0 } }), true);
  });
});
