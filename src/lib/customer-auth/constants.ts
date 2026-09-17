/** Separate from ADMIN_SESSION_COOKIE (src/lib/auth/constants.ts) — customers
 * and admins are entirely different principals with different session
 * cookies, JWT audiences, and DB tables. Never share a cookie name between
 * the two: a name collision would let one session type be read as the
 * other. */
export const CUSTOMER_SESSION_COOKIE = "daakyka_customer";
