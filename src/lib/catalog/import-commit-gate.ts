/**
 * F-08 (docs/audit-2026-09-19/admin-ux.md): whether "Commit import" is
 * allowed to run, extracted out of product-import-form.tsx so the gating
 * rule itself — "a dry run has completed in the current session with zero
 * errors" — is unit-testable without a browser.
 *
 * `dryRun` mirrors the component's own state: `null` until a dry run has
 * been run in this session, and reset back to `null` by the component
 * whenever that would stop being true (a new file is chosen, or a commit
 * just succeeded) — see product-import-form.tsx. This function only ever
 * sees whatever the *current* session's state is, so it can't by itself
 * see a stale dry run from a previous file; that guarantee lives in the
 * component always resetting the state, tested here by simply asserting
 * the function is strict about the shape it's given.
 */
export interface DryRunSummaryForGate {
  summary: { total: number; error: number };
}

export function canCommitImport(dryRun: DryRunSummaryForGate | null): boolean {
  return dryRun !== null && dryRun.summary.error === 0 && dryRun.summary.total > 0;
}
