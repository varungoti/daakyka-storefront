/**
 * F-060: admin timestamps were rendered with `toLocaleString("en-IN")` /
 * `toLocaleDateString("en-IN")` and no `timeZone` option. That formats in
 * the *process's* local timezone — correct on this Asia/Calcutta dev
 * machine, but Vercel functions run in UTC, so every admin timestamp
 * would render 5.5h behind in production (and the dashboard's "today"
 * boundary would reset at 05:30 IST — see `startOfTodayIST` below).
 *
 * Worse, `src/components/admin/notification-list.tsx` is a client
 * component: it formats the same date once during SSR (server timezone)
 * and again at hydration (browser timezone). When those disagree, React
 * throws hydration error #418. Passing an explicit `timeZone` makes the
 * server and the client format identically regardless of either one's
 * local timezone, which fixes both problems at once.
 *
 * India has a single, fixed UTC+5:30 offset with no DST, so pinning
 * `timeZone: "Asia/Kolkata"` is exact year-round — no offset table or
 * DST edge case to worry about.
 */
export const STORE_TZ = "Asia/Kolkata";

/** e.g. "25 Sept 2026, 2:17 pm" — always in IST, on server and client alike. */
export function formatDateTimeIST(date: Date | string | number): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: STORE_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

/** e.g. "25 Sept 2026" — always in IST, on server and client alike. */
export function formatDateIST(date: Date | string | number): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: STORE_TZ,
    dateStyle: "medium",
  }).format(new Date(date));
}

/**
 * F-331: the plain "YYYY-MM-DD" calendar day a Date falls on *in IST* —
 * e.g. for pre-filling/re-editing an `<input type="date">` with the store's
 * own publish day, or for truncating a stored DateTime back down to a
 * date-only value for display. `date.toISOString().slice(0, 10)` (the bug
 * this replaces) reads the *UTC* day instead, which is the previous day for
 * any instant between 00:00 and 05:29 IST. `en-CA` gives a plain
 * "YYYY-MM-DD" — same pattern as startOfTodayIST above.
 */
export function formatIstDateOnly(date: Date | string | number = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ }).format(new Date(date));
}

/**
 * Midnight at the start of "today" in IST, expressed as the equivalent
 * UTC instant — independent of the process's own timezone. Used for
 * "today" boundaries (e.g. the admin dashboard's "Orders Today" card) so
 * they don't silently become UTC-midnight (05:30 IST) boundaries once
 * deployed to Vercel.
 *
 * `now` is injectable so callers (and tests) can pin the clock instead of
 * depending on the real one.
 */
export function startOfTodayIST(now: Date = new Date()): Date {
  // en-CA gives a plain "YYYY-MM-DD" — the IST calendar date for `now`,
  // independent of the process timezone.
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: STORE_TZ }).format(now);
  return new Date(`${ymd}T00:00:00+05:30`);
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * F-068 fix (release-hardening admin-order-list-detail-ux): parses a plain
 * "YYYY-MM-DD" string — exactly what `<input type="date">` sends — as the
 * IST calendar day it names, returning the UTC instant of that day's IST
 * midnight. Never falls back to `new Date(value)`: a date-only ISO string
 * is always read as *UTC* midnight (05:30 IST on this store), which is
 * what silently dropped the admin orders date filter's first ~5.5h of
 * every "From" day (see the admin-orders/export routes, which used to each
 * carry their own `new Date(value)` parseDate). Returns undefined for
 * anything that isn't a strict, valid yyyy-mm-dd string, so a malformed
 * value is ignored rather than becoming an Invalid Date or a UTC-shifted
 * one.
 */
export function parseIstDateOnly(value: string | null | undefined): Date | undefined {
  if (!value || !DATE_ONLY_RE.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00+05:30`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * The exclusive upper bound (the *next* day's IST midnight) for a
 * "YYYY-MM-DD" day — pass to a range filter as `lt`, never `lte`, so the
 * whole named day (through 23:59:59.999 IST) is included. India has a
 * single fixed UTC+5:30 offset with no DST, so adding a flat 24h is exact
 * year-round.
 */
export function parseIstDateOnlyExclusiveEnd(value: string | null | undefined): Date | undefined {
  const start = parseIstDateOnly(value);
  return start ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : undefined;
}
