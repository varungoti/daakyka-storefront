import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

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

/**
 * F-134 fix: a customer's very first saved address becomes their default
 * automatically — before this, `isDefault` only ever became true if the
 * shopper ticked the checkbox themselves, so "Set as default address"
 * silently did nothing for a first-time saver whose checkout never had a
 * default to prefill from. Also the one place that clears every other
 * default when this one is (explicitly, or as the first-address case), all
 * inside one transaction so two addresses can never both end up default.
 *
 * Exported here (not POST /api/account/addresses's route.ts) for the same
 * testability reason as loadOwnAddress above.
 */
export async function createAddressForCustomer(
  customerId: string,
  data: Prisma.CustomerAddressCreateWithoutCustomerInput,
) {
  return db.$transaction(async (tx) => {
    const existingCount = await tx.customerAddress.count({ where: { customerId } });
    const isDefault = Boolean(data.isDefault) || existingCount === 0;

    if (isDefault) {
      await tx.customerAddress.updateMany({ where: { customerId }, data: { isDefault: false } });
    }

    return tx.customerAddress.create({ data: { ...data, isDefault, customerId } });
  });
}

/**
 * F-134 fix: deleting the default address used to promote nothing, so
 * "default address" silently stopped meaning anything the moment it was
 * removed — the customer's oldest remaining address (if any) is promoted
 * instead, in the same transaction as the delete. `existing` is the
 * caller's own already-loaded row (via loadOwnAddress), so this never
 * re-checks ownership itself.
 */
export async function deleteAddressAndPromoteDefault(
  addressId: string,
  customerId: string,
  wasDefault: boolean,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.customerAddress.delete({ where: { id: addressId } });
    if (!wasDefault) return;

    const nextDefault = await tx.customerAddress.findFirst({
      where: { customerId },
      orderBy: { createdAt: "asc" },
    });
    if (nextDefault) {
      await tx.customerAddress.update({ where: { id: nextDefault.id }, data: { isDefault: true } });
    }
  });
}
