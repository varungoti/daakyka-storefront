import { db } from "@/lib/db";

/** Loads a CustomerAddress only if it belongs to the given customer — never
 * trust an :id path param alone. Returns null both for "doesn't exist" and
 * "belongs to someone else", so a caller can't use this to probe which
 * address ids exist for other customers.
 *
 * Exported from a plain lib module (not the route.ts file) so it can be
 * unit/integration tested directly against real DB rows without needing a
 * live Next.js request/cookie round trip — and so route.ts only exports the
 * HTTP method handlers Next.js expects from it. */
export async function loadOwnAddress(id: string, customerId: string) {
  const address = await db.customerAddress.findUnique({ where: { id } });
  if (!address || address.customerId !== customerId) return null;
  return address;
}
