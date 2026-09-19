/**
 * Release-hardening F-13: a pragmatic structural dirty-check used to warn
 * an admin before they navigate away from (or close the tab on) a form
 * with unsaved changes — see docs/audit-2026-09-19/admin-ux.md F-13 and
 * src/components/admin/unsaved-changes.tsx, which wires this into the
 * `beforeunload` guard and the sidebar's navigation guard.
 *
 * Both `current` and `snapshot` must be built by the same function with a
 * stable key order (e.g. a form's own `buildSnapshot()` helper) — this is
 * a cheap `JSON.stringify` comparison, not a general deep-equality
 * utility, so two objects with the same keys in a different order would
 * false-positive as "dirty". That tradeoff is fine here: every caller
 * always builds both sides from the same object-literal shape.
 */
export function isDirty(current: unknown, snapshot: unknown): boolean {
  return JSON.stringify(current) !== JSON.stringify(snapshot);
}
