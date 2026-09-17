"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";

export interface SizeChartFormInitial {
  id: string;
  name: string;
  unit: "IN" | "CM";
  columns: string[];
  rows: string[][];
  notes: string | null;
  categoryCount: number;
  productCount: number;
}

function emptyRow(columnCount: number): string[] {
  return Array.from({ length: columnCount }, () => "");
}

export function SizeChartForm({ initial }: { initial?: SizeChartFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [name, setName] = useState(initial?.name ?? "");
  const [unit, setUnit] = useState<"IN" | "CM">(initial?.unit ?? "IN");
  const [columns, setColumns] = useState<string[]>(initial?.columns ?? ["Size", "Chest", "Waist"]);
  const [rows, setRows] = useState<string[][]>(
    initial?.rows ?? [emptyRow(3), emptyRow(3)],
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const addColumn = () => {
    setColumns((cols) => [...cols, `Column ${cols.length + 1}`]);
    setRows((rs) => rs.map((row) => [...row, ""]));
  };

  const removeColumn = (index: number) => {
    if (columns.length <= 1) return;
    setColumns((cols) => cols.filter((_, i) => i !== index));
    setRows((rs) => rs.map((row) => row.filter((_, i) => i !== index)));
  };

  const addRow = () => setRows((rs) => [...rs, emptyRow(columns.length)]);
  const removeRow = (index: number) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, i) => i !== index)));

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);

    const payload = {
      name: name.trim(),
      unit,
      columns: columns.map((c) => c.trim()).filter(Boolean),
      rows,
      notes: notes.trim() || null,
    };

    if (payload.columns.length === 0) {
      setStatus("error");
      setErrorMessage("Add at least one column.");
      return;
    }

    const response = await fetch(isEdit ? `/api/admin/size-charts/${initial!.id}` : "/api/admin/size-charts", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setStatus("error");
      setErrorMessage(body?.error ?? "Couldn't save — check the table for empty or mismatched rows.");
      return;
    }

    router.push("/admin/size-charts");
    router.refresh();
  };

  const remove = async () => {
    if (!initial) return;
    if (!window.confirm(`Delete "${initial.name}"? This can't be undone.`)) return;
    setDeleteError(null);
    const response = await fetch(`/api/admin/size-charts/${initial.id}`, { method: "DELETE" });
    if (response.ok) {
      router.push("/admin/size-charts");
      router.refresh();
      return;
    }
    const body = await response.json().catch(() => ({}));
    setDeleteError(body?.error ?? "Couldn't delete — try again.");
  };

  return (
    <div className="max-w-4xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">Unit</span>
          <div className="flex gap-2">
            {(["IN", "CM"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setUnit(value)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  unit === value ? "bg-brand text-white" : "border border-border text-muted hover:bg-lilac/40"
                }`}
              >
                {value === "IN" ? "Inches" : "Centimeters"}
              </button>
            ))}
          </div>
        </label>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink">Table</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addColumn}
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40"
            >
              <Plus size={14} /> Column
            </button>
            <button
              type="button"
              onClick={addRow}
              className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-muted hover:bg-lilac/40"
            >
              <Plus size={14} /> Row
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-muted">
                {columns.map((col, colIndex) => (
                  <th key={colIndex} className="border-b border-border p-2 text-left">
                    <div className="flex items-center gap-1">
                      <input
                        value={col}
                        onChange={(e) =>
                          setColumns((cols) => cols.map((c, i) => (i === colIndex ? e.target.value : c)))
                        }
                        className="w-full rounded-lg border border-border bg-surface p-1.5 text-xs font-semibold text-ink"
                      />
                      <button
                        type="button"
                        onClick={() => removeColumn(colIndex)}
                        disabled={columns.length <= 1}
                        aria-label="Remove column"
                        className="shrink-0 rounded p-1 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </th>
                ))}
                <th className="w-8 border-b border-border" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {columns.map((_, colIndex) => (
                    <td key={colIndex} className="border-b border-border p-2">
                      <input
                        value={row[colIndex] ?? ""}
                        onChange={(e) =>
                          setRows((rs) =>
                            rs.map((r, i) =>
                              i === rowIndex ? r.map((cell, ci) => (ci === colIndex ? e.target.value : cell)) : r,
                            ),
                          )
                        }
                        className="w-full rounded-lg border border-border p-1.5 text-sm text-ink"
                      />
                    </td>
                  ))}
                  <td className="border-b border-border p-2 text-center">
                    <button
                      type="button"
                      onClick={() => removeRow(rowIndex)}
                      disabled={rows.length <= 1}
                      aria-label="Remove row"
                      className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-muted">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </label>

      <div>
        <p className="mb-2 text-sm font-semibold text-ink">Live preview</p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[400px] border-collapse text-sm">
            <thead>
              <tr className="bg-surface-muted">
                {columns.map((col, i) => (
                  <th key={i} className="border-b border-border p-2 text-left font-semibold text-ink">
                    {col || `Column ${i + 1}`}
                    {i === 1 ? ` (${unit === "IN" ? "in" : "cm"})` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((_, ci) => (
                    <td key={ci} className="border-b border-border p-2 text-muted">
                      {row[ci] || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
      {deleteError ? <p className="text-sm text-red-600">{deleteError}</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || !name.trim()}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create size chart"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/size-charts")}
          className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40"
        >
          Cancel
        </button>
        {isEdit && (
          <button
            type="button"
            onClick={remove}
            className="ml-auto rounded-full border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        )}
      </div>
      {isEdit && (initial!.categoryCount > 0 || initial!.productCount > 0) && (
        <p className="text-xs text-muted">
          In use by {initial!.categoryCount} categor{initial!.categoryCount === 1 ? "y" : "ies"} and{" "}
          {initial!.productCount} product{initial!.productCount === 1 ? "" : "s"} — unassign before deleting.
        </p>
      )}
    </div>
  );
}
