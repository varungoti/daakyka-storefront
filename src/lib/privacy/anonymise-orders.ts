import type { Prisma } from "@/generated/prisma/client";

/**
 * F-315 / F-316: how an order is anonymised, shared by the erasure service
 * (erase.ts — a person asked) and the retention job (retention.ts — the
 * retention floor has passed). An order's money, tax and invoice figures and
 * its line items must survive (GST records), but the person must not:
 *
 *  - email -> a fixed placeholder, phone / free-text notes / internal notes dropped
 *  - shipping address -> state, pincode and country only (the place of supply
 *    GST needs); the name becomes a placeholder so invoices and the admin order
 *    page still render a complete address block
 *  - the guest-access link is revoked (accessTokenHash) and the Customer link cut
 *
 * Idempotent — re-anonymising an anonymised order changes nothing.
 */

export const ERASED_EMAIL = "erased@invalid";
export const ERASED_NAME = "Erased customer";

type SqlClient = Pick<Prisma.TransactionClient, "$executeRaw">;

/** Returns how many orders were updated. */
export async function anonymiseOrdersById(client: SqlClient, orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  return client.$executeRaw`
    UPDATE "Order"
    SET email = ${ERASED_EMAIL},
        phone = NULL,
        notes = NULL,
        "adminNotes" = NULL,
        "accessTokenHash" = NULL,
        "customerId" = NULL,
        "shippingAddress" = jsonb_build_object(
          'name', ${ERASED_NAME}::text,
          'line1', '',
          'line2', '',
          'city', '',
          'state', COALESCE("shippingAddress"->>'state', ''),
          'pincode', COALESCE("shippingAddress"->>'pincode', ''),
          'country', COALESCE("shippingAddress"->>'country', 'IN')
        ),
        "updatedAt" = now()
    WHERE id = ANY(${orderIds}::text[])
  `;
}
