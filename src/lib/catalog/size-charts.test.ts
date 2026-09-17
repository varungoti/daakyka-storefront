import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sizeChartInputSchema } from "@/lib/catalog/size-charts";

describe("sizeChartInputSchema", () => {
  const valid = {
    name: "Adult Scrubs",
    unit: "IN" as const,
    columns: ["Size", "Chest", "Waist"],
    rows: [
      ["S", "36", "30"],
      ["M", "38", "32"],
    ],
    notes: "Measurements in inches, laid flat",
  };

  it("accepts a well-formed chart", () => {
    const result = sizeChartInputSchema.safeParse(valid);
    assert.equal(result.success, true);
  });

  it("rejects a row whose cell count doesn't match the column count", () => {
    const result = sizeChartInputSchema.safeParse({
      ...valid,
      rows: [["S", "36", "30"], ["M", "38"]],
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.ok(result.error.issues.some((issue) => issue.path.join(".") === "rows.1"));
    }
  });

  it("rejects an empty column list", () => {
    const result = sizeChartInputSchema.safeParse({ ...valid, columns: [] });
    assert.equal(result.success, false);
  });

  it("rejects an empty row list", () => {
    const result = sizeChartInputSchema.safeParse({ ...valid, rows: [] });
    assert.equal(result.success, false);
  });

  it("rejects an invalid unit", () => {
    const result = sizeChartInputSchema.safeParse({ ...valid, unit: "METERS" });
    assert.equal(result.success, false);
  });

  it("allows notes to be omitted or null", () => {
    const withoutNotes: Record<string, unknown> = { ...valid };
    delete withoutNotes.notes;
    assert.equal(sizeChartInputSchema.safeParse(withoutNotes).success, true);
    assert.equal(sizeChartInputSchema.safeParse({ ...valid, notes: null }).success, true);
  });

  it("rejects a blank name", () => {
    const result = sizeChartInputSchema.safeParse({ ...valid, name: "  " });
    assert.equal(result.success, false);
  });
});
