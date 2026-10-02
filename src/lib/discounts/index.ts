import { db } from "@/lib/db";
import { Prisma, type Discount as DiscountRow, type DiscountType } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { diffFields } from "@/lib/auth/audit-diff";
import { formatCurrencyAmount } from "@/lib/currency/convert";
import { validateDiscountRules, type DiscountInput, type DiscountUpdateInput } from "@/lib/validation/schemas";

/**
 * Release-hardening F7 (docs/audit-2026-09-19/storefront-ux.md finding F7 /
 * "Shopify parity gaps": discount codes = High priority). The homepage
 * offers strip already advertises "First Purchase — HERO10"; this module
 * is what makes that redeemable.
 *
 * Design, in one place:
 *
 *  - `resolveDiscount` is a fast, NON-authoritative read used for the
 *    checkout-page live preview (POST /api/checkout/discount) and as a
 *    fail-fast check before order creation. It computes the discount
 *    amount from the DB row every time — a client can send a code string,
 *    never an amount, and nothing here ever reads one.
 *
 *  - `commitDiscountRedemption` is the ONLY function allowed to increment
 *    `Discount.redeemedCount` / insert a `DiscountRedemption` row, via the
 *    same conditional-`updateMany` compare-and-swap already used for
 *    `ProductVariant.stock` and the Order PAID transition (see
 *    src/lib/orders/create-order.ts and /api/checkout/verify). See its own
 *    doc comment for the concurrency argument.
 *
 *  - WHEN the redemption is committed differs by payment method, mirroring
 *    exactly how stock itself is handled for each:
 *      - ORDER_REQUEST has no payment gate, so it commits immediately, in
 *        the same transaction as order creation (createOrderFromCart).
 *      - RAZORPAY defers the commit to the PAID transition (/api/checkout/
 *        verify and the Razorpay webhook), NOT order creation. An
 *        abandoned Razorpay checkout is auto-cancelled 30+ minutes later by
 *        the cancel-stale-orders cron; if a capped code were reserved at
 *        creation time instead, every abandoned cart would permanently
 *        burn one redemption off a scarce code with no release path (that
 *        cron is out of scope for this change). Deferring to PAID avoids
 *        the problem entirely — nothing is ever reserved for an order that
 *        never pays. The discount AMOUNT is still computed and stored on
 *        the order at creation time either way (so the Razorpay amount and
 *        the order summary are correct); only the cap-counted commit is
 *        deferred. If the authoritative commit at PAID time loses the CAS
 *        race (the cap filled in the interim — rare), the payment is never
 *        failed for it (money is already captured) — the order keeps its
 *        already-priced discount and an admin is flagged for manual
 *        review, the same pattern already used for a stock conflict
 *        discovered at PAID time.
 *      - An ORDER_REQUEST order's committed redemption IS released
 *        (redeemedCount decremented, its DiscountRedemption row deleted)
 *        if an admin later cancels it — see admin-orders.ts's
 *        updateOrderAdmin, right alongside the existing stock-restock
 *        logic it already has for the same order type.
 */

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Canonical form stored in `Discount.code` and used for every lookup — a
 * plain `@unique` index on this normalized value is what makes codes
 * case-insensitive without a citext extension. */
export function normalizeDiscountCode(raw: string): string {
  return raw.trim().toUpperCase();
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Checkout-time errors — one class per reason, mirroring
// create-order.ts's EmptyCartError/InvalidVariantError/OutOfStockError so
// route handlers can map each to a specific, useful message.
// ---------------------------------------------------------------------------

export class DiscountNotFoundError extends Error {
  constructor() {
    super("Invalid discount code");
    this.name = "DiscountNotFoundError";
  }
}

export class DiscountInactiveError extends Error {
  constructor() {
    super("This discount code is no longer active");
    this.name = "DiscountInactiveError";
  }
}

export class DiscountNotStartedError extends Error {
  constructor() {
    super("This discount code isn't active yet");
    this.name = "DiscountNotStartedError";
  }
}

export class DiscountExpiredError extends Error {
  constructor() {
    super("This discount code has expired");
    this.name = "DiscountExpiredError";
  }
}

export class DiscountMinSubtotalError extends Error {
  constructor(
    public readonly minSubtotal: number,
    public readonly shortfall: number,
  ) {
    // F-127: `toFixed(0)` rounded the shortfall to the nearest rupee, so a
    // ₹199.99 cart against a ₹1,000 minimum said "Add ₹800 more" when
    // ₹800.01 is needed. The shared formatter keeps the paise (and drops them
    // when there are none) exactly like the totals the shopper is looking at.
    super(
      `Add ${formatCurrencyAmount(shortfall, "INR")} more to your cart to use this code (minimum order ${formatCurrencyAmount(minSubtotal, "INR")})`,
    );
    this.name = "DiscountMinSubtotalError";
  }
}

export class DiscountUsageLimitReachedError extends Error {
  constructor() {
    super("This discount code has reached its usage limit");
    this.name = "DiscountUsageLimitReachedError";
  }
}

export class DiscountAlreadyUsedError extends Error {
  constructor() {
    super("You've already used this discount code");
    this.name = "DiscountAlreadyUsedError";
  }
}

// ---------------------------------------------------------------------------
// Resolution (read) + amount computation
// ---------------------------------------------------------------------------

/** Percentage is capped implicitly (never more than 100% of subtotal) and a
 * fixed amount can never exceed the subtotal either — a discount never
 * makes the merchandise total negative, and it never eats into shipping
 * (see resolveDiscountForOrder's doc comment on the shipping-threshold
 * ordering for the related, separate decision about *when* shipping is
 * computed). */
export function computeDiscountAmount(type: DiscountType, value: number, subtotal: number): number {
  if (subtotal <= 0) return 0;
  const raw = type === "PERCENTAGE" ? (subtotal * value) / 100 : value;
  return roundMoney(Math.min(Math.max(raw, 0), subtotal));
}

function assertDiscountUsable(discount: DiscountRow, subtotal: number, now: Date): void {
  if (!discount.active) throw new DiscountInactiveError();
  if (discount.startsAt && discount.startsAt > now) throw new DiscountNotStartedError();
  if (discount.endsAt && discount.endsAt <= now) throw new DiscountExpiredError();
  if (discount.minSubtotal !== null && subtotal < Number(discount.minSubtotal)) {
    const minSubtotal = Number(discount.minSubtotal);
    throw new DiscountMinSubtotalError(minSubtotal, roundMoney(minSubtotal - subtotal));
  }
  if (discount.maxRedemptions !== null && discount.redeemedCount >= discount.maxRedemptions) {
    throw new DiscountUsageLimitReachedError();
  }
}

export interface ResolvedDiscount {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  /** Computed off the given subtotal, already capped to [0, subtotal] and
   * rounded to 2dp — never trust a client-supplied amount instead of this. */
  amount: number;
  maxRedemptions: number | null;
  maxRedemptionsPerCustomer: number | null;
}

/**
 * Looks up `rawCode`, validates it against `subtotal`/`email`, and returns
 * the computed discount. Fast and convenient, but NOT the concurrency
 * guarantee — two concurrent calls for the same near-exhausted code can
 * both pass this check. Callers that are actually about to commit an order
 * must still go through `commitDiscountRedemption` inside their
 * transaction; this function alone is fine for a live preview (nothing is
 * reserved yet) and as a fail-fast pre-check.
 */
export async function resolveDiscount(
  rawCode: string,
  subtotal: number,
  email: string,
  now: Date = new Date(),
): Promise<ResolvedDiscount> {
  const code = normalizeDiscountCode(rawCode);
  if (!code) throw new DiscountNotFoundError();

  const discount = await db.discount.findUnique({ where: { code } });
  if (!discount) throw new DiscountNotFoundError();

  assertDiscountUsable(discount, subtotal, now);

  if (discount.maxRedemptionsPerCustomer !== null) {
    const usedByCustomer = await db.discountRedemption.count({
      where: { discountId: discount.id, email: normalizeEmail(email) },
    });
    if (usedByCustomer >= discount.maxRedemptionsPerCustomer) {
      throw new DiscountAlreadyUsedError();
    }
  }

  return {
    id: discount.id,
    code: discount.code,
    type: discount.type,
    value: Number(discount.value),
    amount: computeDiscountAmount(discount.type, Number(discount.value), subtotal),
    maxRedemptions: discount.maxRedemptions,
    maxRedemptionsPerCustomer: discount.maxRedemptionsPerCustomer,
  };
}

/**
 * Release-hardening F-004: the homepage offers strip must never advertise
 * a discount code checkout won't actually redeem (HERO10 was exactly this
 * — a card promising a code with no backing Discount row). A caller that
 * renders a code-bearing offer (e.g. src/lib/offers/index.ts) checks this
 * FIRST and hides the card entirely when it's false, rather than showing a
 * dead code and letting the shopper discover "Invalid discount code" at
 * checkout. Deliberately lighter than resolveDiscount()'s full
 * assertDiscountUsable(): this only answers "does this code currently work
 * at all" (missing / inactive / not started / expired) for display
 * purposes — it has no subtotal or email to check a min-subtotal or
 * per-customer cap against, and a display check has no reason to.
 */
export async function isDiscountCodeActive(rawCode: string, now: Date = new Date()): Promise<boolean> {
  const code = normalizeDiscountCode(rawCode);
  if (!code) return false;

  const discount = await db.discount.findUnique({ where: { code } });
  if (!discount) return false;
  if (!discount.active) return false;
  if (discount.startsAt && discount.startsAt > now) return false;
  if (discount.endsAt && discount.endsAt <= now) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Commit (write) — the atomic, concurrency-safe part
// ---------------------------------------------------------------------------

export type CommitDiscountRedemptionResult =
  | { ok: true }
  | { ok: false; reason: "usage_limit" | "already_used" };

/**
 * Atomically reserves one redemption of `discountId` against `orderId`.
 * MUST be called inside the caller's own transaction (`tx`) so the
 * increment and whatever order/payment write it's paired with commit or
 * roll back together.
 *
 * Concurrency: the `updateMany` below is a compare-and-swap exactly like
 * `tx.productVariant.updateMany({ where: { id, stock: { gte: quantity } },
 * ... })` in create-order.ts — its WHERE clause re-evaluates the row's
 * CURRENT committed state, so two callers racing the same near-exhausted
 * code can never both succeed. `maxRedemptions` itself is read once by the
 * caller and passed in as a literal (not re-read here) because it isn't
 * concurrently mutated by checkout traffic — only by a rare, out-of-band
 * admin edit — so comparing the live `redeemedCount` column against that
 * literal is safe, the same way the stock CAS compares live `stock`
 * against a literal `quantity` rather than another column.
 *
 * The `UPDATE` this issues also takes Postgres's normal row lock on the
 * matched `Discount` row for the rest of the transaction. That's what
 * makes the per-customer check just below it safe too: a second concurrent
 * commit for the *same* discount blocks on that lock until this
 * transaction finishes, and when it resumes it re-reads the row (and
 * re-counts `DiscountRedemption`) fresh — so two simultaneous redemptions
 * by the same customer can't both slip under a `maxRedemptionsPerCustomer`
 * cap either, without needing a second dedicated CAS row for that count.
 */
export async function commitDiscountRedemption(
  tx: Prisma.TransactionClient,
  params: {
    discountId: string;
    maxRedemptions: number | null;
    maxRedemptionsPerCustomer: number | null;
    orderId: string;
    email: string;
    customerId?: string | null;
    now?: Date;
  },
): Promise<CommitDiscountRedemptionResult> {
  const now = params.now ?? new Date();

  // F-035 fix (release-hardening order-lifecycle-payment-integrity):
  // idempotent by orderId, checked first. `DiscountRedemption.orderId` is
  // `@unique`, so without this an order that's legitimately re-run through
  // its PAID transition (e.g. a defensive retry, not merely the
  // already-guarded CAS in markRazorpayOrderPaid) would hit a P2002 here
  // instead of recognising "this order's redemption is already committed"
  // and no-opping.
  const existingRedemption = await tx.discountRedemption.findUnique({ where: { orderId: params.orderId } });
  if (existingRedemption) return { ok: true };

  const conditions: Prisma.DiscountWhereInput[] = [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
  ];
  if (params.maxRedemptions !== null) {
    conditions.push({ redeemedCount: { lt: params.maxRedemptions } });
  }

  const cas = await tx.discount.updateMany({
    where: { id: params.discountId, active: true, AND: conditions },
    data: { redeemedCount: { increment: 1 } },
  });
  if (cas.count === 0) return { ok: false, reason: "usage_limit" };

  const email = normalizeEmail(params.email);
  if (params.maxRedemptionsPerCustomer !== null) {
    const usedByCustomer = await tx.discountRedemption.count({
      where: { discountId: params.discountId, email },
    });
    if (usedByCustomer >= params.maxRedemptionsPerCustomer) {
      // This customer specifically is capped out — release the slot we
      // just reserved above so it stays available for someone else.
      await tx.discount.update({
        where: { id: params.discountId },
        data: { redeemedCount: { decrement: 1 } },
      });
      return { ok: false, reason: "already_used" };
    }
  }

  await tx.discountRedemption.create({
    data: {
      discountId: params.discountId,
      orderId: params.orderId,
      email,
      customerId: params.customerId ?? null,
    },
  });
  return { ok: true };
}

/** Mirrors an ORDER_REQUEST cancellation's stock restock (admin-orders.ts):
 * releases a previously-committed redemption back onto the code so it can
 * be reused. Idempotent-by-construction from the caller's side — only ever
 * invoked once per order, guarded the same way restockItems is (see
 * updateOrderAdmin). */
export async function releaseDiscountRedemption(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const redemption = await tx.discountRedemption.findUnique({ where: { orderId } });
  if (!redemption) return;
  await tx.discountRedemption.delete({ where: { orderId } });
  await tx.discount.update({
    where: { id: redemption.discountId },
    data: { redeemedCount: { decrement: 1 } },
  });
}

// ---------------------------------------------------------------------------
// Admin CRUD (create / edit / deactivate + redemption counts)
// ---------------------------------------------------------------------------

export class DiscountNotFoundForAdminError extends Error {
  constructor(id: string) {
    super(`Discount ${id} not found`);
    this.name = "DiscountNotFoundForAdminError";
  }
}

export class DuplicateDiscountCodeError extends Error {
  constructor(code: string) {
    super(`A discount code "${code}" already exists`);
    this.name = "DuplicateDiscountCodeError";
  }
}

// F-038: discountSchema's superRefine only ever sees a create's full
// payload. A PATCH validates each sent field in isolation
// (discountUpdateSchema has no cross-field check — see its doc comment),
// so `{ value: 500 }` against an existing PERCENTAGE code, or `{ endsAt }`
// against an existing startsAt, passed straight through to the DB. Thrown
// by updateDiscount below when the MERGED (existing + incoming) record
// fails the same rules a create would.
export class DiscountValidationError extends Error {
  constructor(public readonly issues: { path: (string | number)[]; message: string }[]) {
    super(issues[0]?.message ?? "Validation failed");
    this.name = "DiscountValidationError";
  }
}

export async function listDiscountsForAdmin(): Promise<DiscountRow[]> {
  return db.discount.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getDiscountForAdmin(id: string): Promise<DiscountRow> {
  const discount = await db.discount.findUnique({ where: { id } });
  if (!discount) throw new DiscountNotFoundForAdminError(id);
  return discount;
}

export async function createDiscount(input: DiscountInput, userId: string): Promise<DiscountRow> {
  const code = normalizeDiscountCode(input.code);
  try {
    const discount = await db.discount.create({
      data: {
        code,
        type: input.type,
        value: input.value,
        minSubtotal: input.minSubtotal ?? null,
        maxRedemptions: input.maxRedemptions ?? null,
        maxRedemptionsPerCustomer: input.maxRedemptionsPerCustomer ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        active: input.active ?? true,
        createdById: userId,
      },
    });
    await logAuditEvent({
      userId,
      action: "create",
      entity: "discount",
      entityId: discount.id,
      metadata: {
        code: discount.code,
        type: discount.type,
        value: Number(discount.value),
        // F-288: the limits a code is created with matter as much as its value.
        minSubtotal: discount.minSubtotal === null ? null : Number(discount.minSubtotal),
        maxRedemptions: discount.maxRedemptions,
        maxRedemptionsPerCustomer: discount.maxRedemptionsPerCustomer,
        startsAt: discount.startsAt?.toISOString() ?? null,
        endsAt: discount.endsAt?.toISOString() ?? null,
        active: discount.active,
      },
    });
    return discount;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateDiscountCodeError(code);
    }
    throw error;
  }
}

/** F-288: the Discount columns whose before -> after is audited on update. */
const DISCOUNT_AUDITED_FIELDS = [
  "code",
  "type",
  "value",
  "minSubtotal",
  "maxRedemptions",
  "maxRedemptionsPerCustomer",
  "startsAt",
  "endsAt",
  "active",
] as const;

export async function updateDiscount(
  id: string,
  input: DiscountUpdateInput,
  userId: string,
): Promise<DiscountRow> {
  const existing = await db.discount.findUnique({ where: { id } });
  if (!existing) throw new DiscountNotFoundForAdminError(id);

  // F-038: validate the record as it will exist AFTER this patch, not just
  // the fields the caller happened to send — but only when the patch touches
  // a field those rules cover. A code saved before the rules existed (a 150%
  // PERCENTAGE code, an end date before its start) must still be deactivable
  // or renameable: re-validating the untouched, already-bad fields would
  // return a 400 for a bare `{ active: false }` and leave the owner unable to
  // switch off the very code that is giving goods away.
  if (
    input.type !== undefined ||
    input.value !== undefined ||
    input.startsAt !== undefined ||
    input.endsAt !== undefined
  ) {
    const merged = {
      type: input.type ?? existing.type,
      value: input.value ?? Number(existing.value),
      startsAt: input.startsAt !== undefined ? input.startsAt : existing.startsAt,
      endsAt: input.endsAt !== undefined ? input.endsAt : existing.endsAt,
    };
    const issues: { path: (string | number)[]; message: string }[] = [];
    validateDiscountRules(merged, (issue) => issues.push(issue));
    if (issues.length > 0) throw new DiscountValidationError(issues);
  }

  const data: Prisma.DiscountUpdateInput = {};
  if (input.code !== undefined) data.code = normalizeDiscountCode(input.code);
  if (input.type !== undefined) data.type = input.type;
  if (input.value !== undefined) data.value = input.value;
  if (input.minSubtotal !== undefined) data.minSubtotal = input.minSubtotal;
  if (input.maxRedemptions !== undefined) data.maxRedemptions = input.maxRedemptions;
  if (input.maxRedemptionsPerCustomer !== undefined) data.maxRedemptionsPerCustomer = input.maxRedemptionsPerCustomer;
  if (input.startsAt !== undefined) data.startsAt = input.startsAt;
  if (input.endsAt !== undefined) data.endsAt = input.endsAt;
  if (input.active !== undefined) data.active = input.active;

  try {
    const updated = await db.discount.update({ where: { id }, data });
    await logAuditEvent({
      userId,
      action: "update",
      entity: "discount",
      entityId: id,
      metadata: {
        code: updated.code,
        active: updated.active,
        // F-288: the row used to say only {code, active}, so raising a
        // 5% code to 90% — or lifting its cap — left no trace of the old
        // value. `changes` is the before -> after of every field that moved.
        changes: diffFields(existing, updated, DISCOUNT_AUDITED_FIELDS),
      },
    });
    return updated;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateDiscountCodeError(String(input.code));
    }
    throw error;
  }
}
