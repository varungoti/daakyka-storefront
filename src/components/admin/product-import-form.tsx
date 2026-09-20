"use client";

import Link from "next/link";
import { useState } from "react";
import { canCommitImport } from "@/lib/catalog/import-commit-gate";
import { cn } from "@/lib/utils";

interface RowResult {
  rowNumber: number;
  status: "ok" | "warning" | "error";
  errors: string[];
  warnings: string[];
  raw: Record<string, string>;
}

interface DryRunSummary {
  rows: RowResult[];
  summary: { total: number; ok: number; warning: number; error: number; products: number };
}

interface CommitSummary {
  productsCreated: number;
  productsUpdated: number;
  variantsWritten: number;
  imagesQueued: number;
}

export function ProductImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<DryRunSummary | null>(null);
  const [commitResult, setCommitResult] = useState<CommitSummary | null>(null);
  const [generateImages, setGenerateImages] = useState(false);
  const [busy, setBusy] = useState<"idle" | "dryRun" | "commit">("idle");
  const [notice, setNotice] = useState<string | null>(null);

  // F-08 (docs/audit-2026-09-19/admin-ux.md): "a dry run has completed in
  // the current session with zero errors" — see import-commit-gate.ts for
  // the (unit-tested) rule itself. `dryRun` is reset to null below
  // whenever a new file is chosen or a commit just succeeded, which is
  // what keeps this scoped to "this session" rather than a stale run.
  const canCommit = canCommitImport(dryRun);

  async function runDryRun() {
    if (!file) return;
    setBusy("dryRun");
    setNotice(null);
    setCommitResult(null);
    const form = new FormData();
    form.append("file", file);
    form.append("mode", "dryRun");
    const response = await fetch("/api/admin/products/import", { method: "POST", body: form });
    setBusy("idle");
    if (!response.ok) {
      setNotice("Dry run failed — check the file and try again.");
      return;
    }
    setDryRun(await response.json());
  }

  async function runCommit() {
    if (!file || !canCommit) return;
    setBusy("commit");
    setNotice(null);
    const form = new FormData();
    form.append("file", file);
    form.append("mode", "commit");
    form.append("generateImages", generateImages ? "yes" : "no");
    const response = await fetch("/api/admin/products/import", { method: "POST", body: form });
    setBusy("idle");
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setNotice(body?.error ?? "Commit failed.");
      return;
    }
    setCommitResult(await response.json());
    setDryRun(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Link href="/api/admin/products/import/template" className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted hover:bg-lilac/40">
          Download CSV template
        </Link>
        <Link href="/api/admin/products/export" className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted hover:bg-lilac/40">
          Export all products (CSV)
        </Link>
      </div>

      <div className="space-y-3 rounded-2xl border border-border bg-surface p-6">
        <label className="block text-sm font-semibold text-ink">
          Upload CSV
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setDryRun(null);
              setCommitResult(null);
            }}
            className="mt-2 block w-full text-sm"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={runDryRun} disabled={!file || busy !== "idle"} className="rounded-full border border-brand px-5 py-2.5 text-sm font-semibold text-brand disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:opacity-60">
            {busy === "dryRun" ? "Validating…" : "Run dry run"}
          </button>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={generateImages} onChange={(e) => setGenerateImages(e.target.checked)} />
            Generate AI images for imported products without any
          </label>
          {/* F-08 (docs/audit-2026-09-19/admin-ux.md): before a dry run has
              completed in this session with zero errors, this used to keep
              the exact same solid brand-purple fill as when it's genuinely
              ready to click — `disabled:opacity-40` alone barely reads as
              "off" against a saturated fill the way it does on the
              outlined "Run dry run" button next to it. `canCommit` already
              gated the click handler correctly; only the *styling* needed
              to stop pretending the button was equally ready either way, so
              the not-ready state now falls back to the same flat, neutral
              "clearly inactive" treatment as every other disabled control
              in this admin (see e.g. category-tree.tsx's disabled:opacity-40
              on a *neutral* button) instead of a dimmed version of the
              active color. */}
          <button
            type="button"
            onClick={runCommit}
            disabled={!canCommit || busy !== "idle"}
            title={canCommit ? "" : "Run a dry run with zero errors first"}
            className={cn(
              "rounded-full px-5 py-2.5 text-sm font-semibold transition",
              canCommit
                ? "bg-brand text-white hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-60"
                : "cursor-not-allowed border border-border bg-surface-muted text-muted",
            )}
          >
            {busy === "commit" ? "Importing…" : "Commit import"}
          </button>
        </div>

        {notice ? <p className="text-sm text-red-600">{notice}</p> : null}
      </div>

      {dryRun && (
        <div className="space-y-3 rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-display text-lg font-bold text-ink">Dry run results</h2>
          <p className="text-sm text-muted">
            {dryRun.summary.total} rows · {dryRun.summary.products} products · {dryRun.summary.ok} ok · {dryRun.summary.warning} warnings · {dryRun.summary.error} errors
          </p>
          <div className="max-h-96 overflow-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-xs">
              <thead className="sticky top-0 bg-surface-muted text-left text-[11px] font-semibold text-muted">
                <tr>
                  <th className="p-2">Row</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">Product</th>
                  <th className="p-2">Messages</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.rows.map((row) => (
                  <tr key={row.rowNumber} className="border-t border-border">
                    <td className="p-2">{row.rowNumber}</td>
                    <td className="p-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          row.status === "ok" ? "bg-green-100 text-green-700" : row.status === "warning" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="p-2">{row.raw.product_slug}</td>
                    <td className="p-2">{[...row.errors, ...row.warnings].join("; ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {commitResult && (
        <div className="space-y-2 rounded-2xl border border-green-200 bg-green-50 p-6 text-sm text-green-800">
          <h2 className="font-display text-lg font-bold">Import complete</h2>
          <p>
            {commitResult.productsCreated} products created, {commitResult.productsUpdated} updated, {commitResult.variantsWritten} variants written
            {commitResult.imagesQueued > 0 ? `, ${commitResult.imagesQueued} AI images generated` : ""}.
          </p>
        </div>
      )}
    </div>
  );
}
