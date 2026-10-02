/**
 * F-288: an AuditLog row used to say "this product / discount / role was
 * updated" and nothing else — a price dropped from 500 to 1, a discount
 * raised from 5% to 90% and an admin promoted to SUPER_ADMIN all left a row
 * with the *new* name or code and no trace of the change. These helpers
 * build the before -> after record that goes in `metadata`.
 *
 * Pure and free of Next/DB imports so they are trivially unit-testable.
 * Compute the diff *after* the write succeeded (so a rolled-back or rejected
 * change never logs a phantom one) from the row loaded before it.
 */

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export type FieldChanges = Record<string, FieldChange>;

/** Long free text (a product description's HTML, an SEO blurb) is kept out
 * of audit rows: a truncated body would be a misleading diff, and the row
 * should stay small. Strings longer than this are cut for display. */
const MAX_STRING_LENGTH = 200;

/** Prisma `Decimal` -> number, `Date` -> ISO string, `undefined` -> null, and
 * arrays element-wise, so two values that mean the same thing compare equal
 * and JSON.stringify never yields `{}` for a Decimal. */
export function normaliseAuditValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normaliseAuditValue);
  if (typeof value === "object") {
    const maybeDecimal = value as { toNumber?: unknown };
    if (typeof maybeDecimal.toNumber === "function") return (maybeDecimal.toNumber as () => number).call(value);
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clip(value: unknown): unknown {
  return typeof value === "string" && value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
}

/**
 * `{ field: { from, to } }` for every key in `keys` whose value differs
 * between `before` and `after`. A field that did not change is absent, so an
 * ordinary save that re-sends every unchanged field (the admin form does)
 * yields `{}`.
 */
export function diffFields(before: object, after: object, keys: readonly string[]): FieldChanges {
  const changes: FieldChanges = {};
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  for (const key of keys) {
    const from = normaliseAuditValue(previous[key]);
    const to = normaliseAuditValue(next[key]);
    if (!sameValue(from, to)) changes[key] = { from: clip(from), to: clip(to) };
  }
  return changes;
}

/** Names of the keys whose value differs — for large fields whose contents
 * should not be copied into the audit row (a description's HTML). */
export function changedFieldNames(before: object, after: object, keys: readonly string[]): string[] {
  return Object.keys(diffFields(before, after, keys));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * For a JSON content blob (a homepage section, a blog block list): which
 * top-level keys differ between the stored JSON string and the new value,
 * without copying the (large) content itself into the audit row. When either
 * side is not a JSON object the whole value counts as one change, reported
 * as `["(content)"]`; an unchanged save returns `[]`.
 */
export function changedContentKeys(beforeJson: string | null | undefined, after: unknown): string[] {
  let before: unknown = null;
  try {
    before = beforeJson ? JSON.parse(beforeJson) : null;
  } catch {
    before = null;
  }
  if (!isPlainObject(before) || !isPlainObject(after)) {
    return sameValue(before, normaliseAuditValue(after)) ? [] : ["(content)"];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !sameValue(before[key] ?? null, after[key] ?? null)).sort();
}
