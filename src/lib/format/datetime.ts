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
