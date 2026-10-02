import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sizeChartInputSchema } from "@/lib/catalog/size-charts";
import { notesStateUnit } from "@/lib/catalog/size-chart-notes";

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

// F-114: the PDP size-guide dialog printed "Measurements in inches" twice when
// the chart's own notes already said so.
describe("notesStateUnit", () => {
  it("recognises notes that already state the unit, in any wording of the phrase", () => {
    assert.equal(notesStateUnit("Measurements in inches, laid flat. Allow 0.5-1 for movement."), true);
    assert.equal(notesStateUnit("Measurements in inches."), true);
    assert.equal(notesStateUnit("measurement in cm"), true);
    assert.equal(notesStateUnit("All MEASUREMENTS   IN centimetres"), true);
  });

  it("does not hide the unit line for notes that say something else", () => {
    assert.equal(notesStateUnit("Size number is the chest measurement on the garment label."), false);
    assert.equal(notesStateUnit("Take two measurements inside the arm."), false);
    assert.equal(notesStateUnit("Allow 0.5-1 inch for movement"), false);
    assert.equal(notesStateUnit(""), false);
    assert.equal(notesStateUnit(null), false);
    assert.equal(notesStateUnit(undefined), false);
  });
});
