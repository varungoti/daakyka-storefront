"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { COLOR_PRESETS, SIZE_PRESET_LABELS, SIZE_PRESETS, sizePresetKeys, type SizePresetKey } from "@/lib/catalog/size-presets";
import { assertUniqueVariants, generateSku, generateVariantMatrix, type VariantDraft } from "@/lib/catalog/product-validation";

export interface VariantRow extends VariantDraft {
  id?: string; // present once persisted
}

/**
 * F-179: the single source of truth for "is this variant grid safe to
 * save" — used both for the inline warning below the grid and by
 * ProductForm to block Save *before* it ever POSTs the product, so a
 * duplicate (size, color) or an out-of-range stock/price value can no
 * longer create a product first and then silently fail (and lose) the
 * variant save. Mirrors the server's own checks: `assertUniqueVariants`
 * (also used by replaceVariants in src/lib/catalog/products.ts, so the
 * rule can't drift) for duplicate size/colour or SKU, plus the same
 * stock/price bounds as `variantSchema` there (int stock >= 0, price
 * override either absent or > 0).
 */
export function getVariantGridError(variants: VariantRow[]): string | null {
  for (const row of variants) {
    if (!Number.isInteger(row.stock) || row.stock < 0) {
      return `Stock for ${row.size} / ${row.color} must be a whole number that isn't negative.`;
    }
    if (row.price != null && !(row.price > 0)) {
      return `Price override for ${row.size} / ${row.color} must be greater than 0.`;
    }
  }
  try {
    assertUniqueVariants(variants);
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid variant grid.";
  }
  return null;
}

/**
 * Size/colour picker + "Generate variants" matrix builder + inline grid
 * editor, for the product admin form (Phase B1). Size presets come from
 * src/lib/catalog/size-presets.ts; colours have a swatch grid plus a
 * free-text "custom colour" add.
 */
export function ProductVariantEditor({
  categoryName,
  productSlug,
  variants,
  onChange,
}: {
  categoryName: string;
  productSlug: string;
  variants: VariantRow[];
  onChange: (variants: VariantRow[]) => void;
}) {
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedColors, setSelectedColors] = useState<{ name: string; hex?: string }[]>([]);
  const [customSizeInput, setCustomSizeInput] = useState("");
  const [customColorName, setCustomColorName] = useState("");
  const [customColorHex, setCustomColorHex] = useState("#8A347D");
  const [applyStock, setApplyStock] = useState<number | "">("");

  const toggleSize = (size: string) => {
    setSelectedSizes((prev) => (prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]));
  };

  const toggleColor = (color: { name: string; hex?: string }) => {
    setSelectedColors((prev) =>
      prev.some((c) => c.name === color.name) ? prev.filter((c) => c.name !== color.name) : [...prev, color],
    );
  };

  const addCustomSize = () => {
    const value = customSizeInput.trim();
    if (value && !selectedSizes.includes(value)) setSelectedSizes((prev) => [...prev, value]);
    setCustomSizeInput("");
  };

  const addCustomColor = () => {
    const name = customColorName.trim();
    if (!name) return;
    if (!selectedColors.some((c) => c.name === name)) {
      setSelectedColors((prev) => [...prev, { name, hex: customColorHex }]);
    }
    setCustomColorName("");
  };

  const generate = () => {
    if (selectedSizes.length === 0 || selectedColors.length === 0) return;
    const generated = generateVariantMatrix({
      categoryName: categoryName || "General",
      productSlug: productSlug || "product",
      sizes: selectedSizes,
      colors: selectedColors,
    });
    // Keep any existing rows whose (size,color) is not in the new matrix,
    // and don't duplicate ones that already exist.
    const existingKeys = new Set(variants.map((v) => `${v.size}::${v.color}`));
    const merged = [...variants, ...generated.filter((g) => !existingKeys.has(`${g.size}::${g.color}`))];
    onChange(merged);
  };

  const updateRow = (index: number, patch: Partial<VariantRow>) => {
    const next = variants.slice();
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const removeRow = (index: number) => {
    onChange(variants.filter((_, i) => i !== index));
  };

  const regenerateSku = (index: number) => {
    const row = variants[index];
    updateRow(index, { sku: generateSku({ categoryName: categoryName || "General", productSlug: productSlug || "product", size: row.size, color: row.color }) });
  };

  const applyStockToAll = () => {
    if (applyStock === "") return;
    onChange(variants.map((v) => ({ ...v, stock: Number(applyStock) })));
  };

  const gridError = useMemo(() => getVariantGridError(variants), [variants]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-muted">Sizes</p>
          <div className="space-y-2">
            {sizePresetKeys.map((key: SizePresetKey) => (
              <div key={key}>
                <p className="mb-1 text-[11px] font-semibold text-muted">{SIZE_PRESET_LABELS[key]}</p>
                <div className="flex flex-wrap gap-1.5">
                  {SIZE_PRESETS[key].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => toggleSize(size)}
                      aria-pressed={selectedSizes.includes(size)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium",
                        selectedSizes.includes(size) ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:bg-lilac/40",
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                value={customSizeInput}
                onChange={(e) => setCustomSizeInput(e.target.value)}
                placeholder="Custom size"
                aria-label="Custom size"
                className="w-32 rounded-lg border border-border p-1.5 text-xs"
              />
              <button type="button" onClick={addCustomSize} className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted hover:bg-lilac/40">
                + Add
              </button>
            </div>
            {selectedSizes.length > 0 && <p className="text-[11px] text-muted">Selected: {selectedSizes.join(", ")}</p>}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold text-muted">Colours</p>
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((color) => (
              <button
                key={color.name}
                type="button"
                onClick={() => toggleColor(color)}
                aria-pressed={selectedColors.some((c) => c.name === color.name)}
                title={color.name}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-medium",
                  selectedColors.some((c) => c.name === color.name) ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:bg-lilac/40",
                )}
              >
                <span className="h-3.5 w-3.5 rounded-full border border-border" style={{ backgroundColor: color.hex }} />
                {color.name}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={customColorName}
              onChange={(e) => setCustomColorName(e.target.value)}
              placeholder="Custom colour name"
              aria-label="Custom colour name"
              className="w-36 rounded-lg border border-border p-1.5 text-xs"
            />
            <input
              type="color"
              value={customColorHex}
              onChange={(e) => setCustomColorHex(e.target.value)}
              aria-label="Custom colour shade"
              className="h-7 w-9 rounded border border-border"
            />
            <button type="button" onClick={addCustomColor} className="rounded-full border border-border px-2.5 py-1 text-xs font-semibold text-muted hover:bg-lilac/40">
              + Add
            </button>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={generate}
        disabled={selectedSizes.length === 0 || selectedColors.length === 0}
        className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Generate variants ({selectedSizes.length * selectedColors.length || 0})
      </button>

      {gridError ? <p className="text-xs text-red-600">{gridError}</p> : null}

      {variants.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={applyStock}
              onChange={(e) => setApplyStock(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder="Stock"
              aria-label="Stock to apply to every variant"
              className="w-24 rounded-lg border border-border p-1.5 text-xs"
            />
            <button type="button" onClick={applyStockToAll} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40">
              Apply stock to all
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-surface-muted text-left text-[11px] font-semibold text-muted">
                <tr>
                  <th className="p-2">Size</th>
                  <th className="p-2">Colour</th>
                  <th className="p-2">SKU</th>
                  <th className="p-2">Stock</th>
                  <th className="p-2">Price override</th>
                  <th className="p-2">Active</th>
                  <th className="p-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {variants.map((row, index) => (
                  <tr key={`${row.size}-${row.color}-${index}`} className="border-t border-border">
                    <td className="p-2">{row.size}</td>
                    <td className="p-2">
                      <span className="flex items-center gap-1.5">
                        {row.colorHex ? <span className="h-3 w-3 rounded-full border border-border" style={{ backgroundColor: row.colorHex }} /> : null}
                        {row.color}
                      </span>
                    </td>
                    <td className="p-2">
                      <div className="flex items-center gap-1">
                        {/* F-192: was a read-only <span> with only a "regen"
                            link, so an existing barcode/SKU (e.g. one
                            already printed on stock, or copied from an
                            order) could never be typed in — only CSV import
                            could set it. Uniqueness is still enforced the
                            same way a regenerated SKU always was: the grid
                            warning above (getVariantGridError) and the
                            server's own unique constraint on save. */}
                        <input
                          value={row.sku}
                          onChange={(e) => updateRow(index, { sku: e.target.value })}
                          aria-label={`SKU for ${row.size} / ${row.color}`}
                          className="w-32 rounded border border-border p-1 font-mono text-[11px] uppercase"
                        />
                        <button type="button" onClick={() => regenerateSku(index)} className="text-[10px] text-brand underline">
                          regen
                          <span className="sr-only"> SKU for {row.size} / {row.color}</span>
                        </button>
                      </div>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        value={row.stock}
                        onChange={(e) => updateRow(index, { stock: Number(e.target.value) })}
                        aria-label={`Stock for ${row.size} / ${row.color}`}
                        className="w-20 rounded border border-border p-1"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={row.price ?? ""}
                        onChange={(e) => updateRow(index, { price: e.target.value === "" ? null : Number(e.target.value) })}
                        placeholder="—"
                        aria-label={`Price override for ${row.size} / ${row.color}`}
                        className="w-24 rounded border border-border p-1"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={row.active}
                        onChange={(e) => updateRow(index, { active: e.target.checked })}
                        aria-label={`Active: ${row.size} / ${row.color}`}
                      />
                    </td>
                    <td className="p-2">
                      <button type="button" onClick={() => removeRow(index)} className="text-[11px] text-red-600 hover:underline">
                        Remove
                        <span className="sr-only"> {row.size} / {row.color} variant</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
