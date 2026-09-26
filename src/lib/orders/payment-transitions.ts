import type { OrderStatus, Prisma } from "@/generated/prisma/client";
import { commitDiscountRedemption, releaseDiscountRedemption } from "@/lib/discounts";

/**
 * F-035/F-036/F-039 fix (release-hardening order-lifecycle-payment-integrity):
 * the single place that flips a RAZORPAY order to PAID and applies the
 * side effects that go with it (stock decrement, discount-cap commit,
 * conflict notes). Before this existed, POST /api/checkout/verify,
 * the Razorpay webhook's payment.captured handler, and (new) an admin's
 * manual PENDING_PAYMENT -> PAID each had their own copy of this logic —
 * see the F-035 finding for how that let a replayed /verify call or a
 * redelivered webhook regress a SHIPPED/REFUNDED/CANCELLED order back to
 * PAID and double-decrement stock, because each copy's compare-and-swap
 * only checked `status !== "PAID"` rather than "was this order ever
 * actually paid before".
 *
 * The correctness gate is `markRazorpayOrderPaid`'s conditional
 * `updateMany` — `status: { in: ["PENDING_PAYMENT", "CANCELLED"] },
 * razorpayPaymentId: null`. That allows exactly two legitimate paths to
 * PAID:
 *   - the normal one, PENDING_PAYMENT -> PAID;
 *   - a late/out-of-order payment.captured arriving after this same
 *     order was auto-cancelled (stale-order cron) or cancelled by an
 *     earlier payment.failed — recoverable because neither of those ever
 *     set `razorpayPaymentId`, so nothing was ever actually paid yet.
 * Every other status (PROCESSING, SHIPPED, DELIVERED, REFUNDED, or a
 * CANCELLED order that already carries a `razorpayPaymentId` because an
 * admin cancelled it *after* payment) fails the CAS and is left alone —
 * exactly the set of states ORDER_STATUS_TRANSITIONS never allows a
 * PAID-ward edge back into.
 */

export interface OrderItemForPaymentTransition {
  variantId: string | null;
  quantity: number;
}

/** Structural subset of the fields every caller already has on hand (each
 * fetches the order with `include: { items: true, appliedDiscount: true }`
 * or equivalent) — deliberately not `Prisma.OrderGetPayload<...>` so this
 * module doesn't force one particular `include` shape on every caller. */
export interface OrderForPaymentTransition {
  id: string;
  status: OrderStatus;
  adminNotes: string | null;
  email: string;
  customerId: string | null;
  discountId: string | null;
  appliedDiscount: { maxRedemptions: number | null; maxRedemptionsPerCustomer: number | null } | null;
  items: readonly OrderItemForPaymentTransition[];
}

export interface PaidSideEffectsResult {
  stockConflict: boolean;
  discountConflict: boolean;
}

const STOCK_CONFLICT_NOTE =
  "STOCK CONFLICT: manual review needed — an item sold out between order creation and payment.";
const DISCOUNT_CONFLICT_NOTE =
  "DISCOUNT CONFLICT: manual review needed — the discount code's usage limit filled up between order creation and payment. The customer already paid the discounted amount.";

/**
 * F-255 fix (release-hardening order-lifecycle-payment-integrity): decrements
 * stock for every line in one bulk `UPDATE ... FROM unnest(...)` statement
 * (conditional per-row on the row still having enough of it, same rule as
 * the old per-line loop) instead of one `updateMany` round trip per line —
 * a large paid order used to pay for that with N sequential DB round trips
 * inside the transaction that also just flipped the order to PAID, risking
 * Prisma's transaction timeout for exactly the same reason create-order.ts's
 * checkout transaction did (see that file's fix note). Relies on
 * `order.items` never containing the same `variantId` twice — true today
 * because every caller re-fetches `items` straight off the `Order` row,
 * which was itself built from create-order.ts's already-deduplicated
 * `repriceLines` — since `UPDATE ... FROM` only applies one matching row
 * per target, not a sum, if that ever changed.
 */
async function decrementStock(
  tx: Prisma.TransactionClient,
  items: readonly OrderItemForPaymentTransition[],
): Promise<{ stockConflict: boolean }> {
  const lines = items.filter((item): item is typeof item & { variantId: string } => item.variantId !== null);
  if (lines.length === 0) return { stockConflict: false };

  const variantIds = lines.map((line) => line.variantId);
  const quantities = lines.map((line) => line.quantity);
  const decremented = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "ProductVariant" AS v
    SET stock = v.stock - x.qty, "updatedAt" = now()
    FROM unnest(${variantIds}::text[], ${quantities}::int[]) AS x(id, qty)
    WHERE v.id = x.id AND v.stock >= x.qty
    RETURNING v.id
  `;
  return { stockConflict: decremented.length < lines.length };
}

/**
 * Decrements stock for every line (conditional on the row still having
 * enough of it, same as create-order.ts's ORDER_REQUEST path), commits the
 * order's discount redemption if it has one, and records any conflict (or
 * `extraNote`) on `adminNotes` — all in the caller's transaction. Callers
 * are responsible for their own CAS/guard before calling this; it always
 * applies the side effects unconditionally.
 */
export async function applyPaidSideEffects(
  tx: Prisma.TransactionClient,
  order: OrderForPaymentTransition,
  extraNote?: string | null,
): Promise<PaidSideEffectsResult> {
  const { stockConflict } = await decrementStock(tx, order.items);

  let discountConflict = false;
  if (order.discountId && order.appliedDiscount) {
    const commit = await commitDiscountRedemption(tx, {
      discountId: order.discountId,
      maxRedemptions: order.appliedDiscount.maxRedemptions,
      maxRedemptionsPerCustomer: order.appliedDiscount.maxRedemptionsPerCustomer,
      orderId: order.id,
      email: order.email,
      customerId: order.customerId,
    });
    if (!commit.ok) discountConflict = true;
  }

  if (stockConflict || discountConflict || extraNote) {
    const notes = [
      order.adminNotes,
      extraNote ?? null,
      stockConflict ? STOCK_CONFLICT_NOTE : null,
      discountConflict ? DISCOUNT_CONFLICT_NOTE : null,
    ].filter(Boolean);
    if (notes.length > 0) {
      await tx.order.update({ where: { id: order.id }, data: { adminNotes: notes.join("\n") } });
    }
  }

  return { stockConflict, discountConflict };
}

export interface MarkOrderPaidResult extends PaidSideEffectsResult {
  /** False when this call lost the CAS race (or the order wasn't eligible
   * to become PAID at all) — the loser must never touch stock/discount a
   * second time for the same payment, and callers should treat it as a
   * clean no-op (still report success upstream; see verify/webhook). */
  won: boolean;
}

/**
 * F-035/F-285 fix: the shared PAID transition used by /api/checkout/verify
 * and the Razorpay webhook's payment.captured handler. `order` must be the
 * pre-transaction snapshot (read before this call) — `order.status` is
 * read here specifically to decide whether to record a "recovered from a
 * stale cancellation" note (F-285), so it must reflect the row's state
 * *before* this transition, not after.
 */
export async function markRazorpayOrderPaid(
  tx: Prisma.TransactionClient,
  order: OrderForPaymentTransition,
  paymentId: string,
): Promise<MarkOrderPaidResult> {
  const transition = await tx.order.updateMany({
    where: {
      id: order.id,
      // The correctness gate — see this module's header comment for why
      // CANCELLED (with no razorpayPaymentId yet) is included alongside
      // PENDING_PAYMENT.
      status: { in: ["PENDING_PAYMENT", "CANCELLED"] },
      razorpayPaymentId: null,
    },
    // F-334: paidAt records when this order actually reached PAID.
    data: { status: "PAID", razorpayPaymentId: paymentId, paidAt: new Date() },
  });
  if (transition.count !== 1) {
    return { won: false, stockConflict: false, discountConflict: false };
  }

  // F-285: a stale "Payment failed" / "Auto-cancelled" note from an
  // earlier attempt on this same order must not be left standing once a
  // later attempt actually pays — record the recovery inline instead of
  // silently leaving the misleading note as the last word.
  const recoveryNote =
    order.status === "CANCELLED"
      ? `Paid via Razorpay ${paymentId} at ${new Date().toISOString()} (was CANCELLED).`
      : null;

  const { stockConflict, discountConflict } = await applyPaidSideEffects(tx, order, recoveryNote);
  return { won: true, stockConflict, discountConflict };
}

export interface OrderForInventoryRelease {
  id: string;
  discountId: string | null;
  items: readonly OrderItemForPaymentTransition[];
}

/**
 * F-036 fix: gives back stock and releases a committed discount redemption
 * for an order whose PAID transition already ran `applyPaidSideEffects`
 * (or ORDER_REQUEST's equivalent at creation) — used when that order is
 * later cancelled or refunded. Mirrors admin-orders.ts's existing
 * ORDER_REQUEST restock loop; kept here too so the Razorpay
 * refund.processed webhook (which never went through admin-orders.ts) can
 * reuse the exact same logic instead of a third copy.
 *
 * F-255 fix: also used directly by admin-orders.ts's `updateOrderAdmin` now
 * (instead of a second, unbatched copy of this same increment loop there),
 * so a restock on a large order costs one bulk statement, not one per line
 * — see `decrementStock`'s doc comment for why that's safe.
 */
export async function releaseOrderInventory(
  tx: Prisma.TransactionClient,
  order: OrderForInventoryRelease,
): Promise<{ restockedUnits: number }> {
  const lines = order.items.filter((item): item is typeof item & { variantId: string } => item.variantId !== null);
  let restockedUnits = 0;
  if (lines.length > 0) {
    const variantIds = lines.map((line) => line.variantId);
    const quantities = lines.map((line) => line.quantity);
    await tx.$executeRaw`
      UPDATE "ProductVariant" AS v
      SET stock = v.stock + x.qty, "updatedAt" = now()
      FROM unnest(${variantIds}::text[], ${quantities}::int[]) AS x(id, qty)
      WHERE v.id = x.id
    `;
    restockedUnits = quantities.reduce((sum, quantity) => sum + quantity, 0);
  }
  if (order.discountId) {
    await releaseDiscountRedemption(tx, order.id);
  }
  return { restockedUnits };
}
