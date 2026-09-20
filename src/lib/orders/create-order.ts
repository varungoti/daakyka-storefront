import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getSetting } from "@/lib/settings";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import {
  generateOrderNumberCandidate,
  MAX_ORDER_NUMBER_ATTEMPTS,
  OrderNumberGenerationError,
} from "@/lib/orders/number";
import { generateOrderAccessToken, hashOrderAccessToken } from "@/lib/orders/access-token";
import {
  commitDiscountRedemption,
  DiscountAlreadyUsedError,
  DiscountUsageLimitReachedError,
  resolveDiscount,
  type ResolvedDiscount,
} from "@/lib/discounts";

/**
 * Phase D3: server-side order creation from the client cart.
 *
 * Every line is re-priced from the current `ProductVariant`/`Product` row
 * — the caller only ever supplies `{variantId, quantity}`; a price, name,
 * or image sent by the client (however it got there) is never read or
 * trusted. Stock and product status are re-checked here too, right before
 * the transaction, closing most of the window a stale client-side cart
 * could otherwise exploit.
 *
 * Design decision (documented for the phase report): unlike a Razorpay
 * order — which stays PENDING_PAYMENT and only decrements stock once
 * payment is verified (see /api/checkout/verify and the webhook) — an
 * ORDER_REQUEST order has no online payment gate at all, so nothing else
 * would ever reserve the stock it just promised the customer. To avoid
 * overselling the same last unit to two order-request customers, stock is
 * decremented immediately, inside this same transaction, for
 * ORDER_REQUEST orders, and the order is created straight into
 * `PROCESSING` (a Razorpay order stays `PENDING_PAYMENT` until paid).
 *
 * Release-hardening F-01 / plan item 1.4 ("guest checkout mints a fake
 * Customer not linked to the order"): guest checkout (no session ->
 * `input.customerId` is `undefined`) deliberately never creates a
 * `Customer` row here or anywhere else in this function. `Order.email`,
 * `Order.phone` and `Order.shippingAddress` (which carries the shopper's
 * typed name) are the complete, self-contained, real record of a guest's
 * contact details — see src/lib/orders/admin-orders.ts, which surfaces
 * them to the admin as-is, never fabricated. `customerId` is only ever set
 * from an ID the caller already resolved to an existing, authenticated
 * session (see getOptionalCustomerId in src/app/api/checkout/route.ts) —
 * this function never invents one. A shopper who checks out as a guest and
 * later registers with the same email can have their prior guest orders
 * retroactively attached via linkGuestOrdersToCustomer (see
 * src/lib/orders/claim-guest-orders.ts), which sets `Order.customerId` on
 * exactly those rows without ever touching `Order.email`/`phone`.
 */

export interface CreateOrderItemInput {
  variantId: string;
  quantity: number;
}

export type OrderPaymentMethod = "RAZORPAY" | "ORDER_REQUEST";

export interface CreateOrderFromCartInput {
  items: CreateOrderItemInput[];
  email: string;
  phone?: string;
  shippingAddress: ShippingAddressInput;
  customerId?: string;
  paymentMethod: OrderPaymentMethod;
  /** Optional coupon code typed at checkout — a code string only, NEVER an
   * amount. Re-looked-up and re-priced entirely from the DB via
   * src/lib/discounts/index.ts; see repriceLines's own comment for why the
   * same rule applies to every other checkout input. */
  discountCode?: string;
}

export interface CreatedOrder {
  id: string;
  number: string;
  /** Raw (unhashed) capability token for guest access to /order/[number] —
   * exists only here, in the checkout redirect URL, and in the
   * order-confirmation email link. Never persisted as-is; only its hash
   * (Order.accessTokenHash) is stored. See src/lib/orders/access-token.ts. */
  accessToken: string;
  subtotal: number;
  shipping: number;
  discount: number;
  discountCode: string | null;
  total: number;
  currency: string;
  status: string;
  paymentMethod: OrderPaymentMethod;
  email: string;
}

export class EmptyCartError extends Error {
  constructor() {
    super("Your cart is empty");
    this.name = "EmptyCartError";
  }
}

export class InvalidVariantError extends Error {
  constructor(public readonly variantId: string) {
    super(`Product variant ${variantId} is no longer available`);
    this.name = "InvalidVariantError";
  }
}

export class OutOfStockError extends Error {
  constructor(
    public readonly variantId: string,
    public readonly productName: string,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(`${productName} is out of stock (requested ${requested}, only ${available} available)`);
    this.name = "OutOfStockError";
  }
}

export interface RepricedLine {
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
}

/**
 * Exported so callers that need a truthful, server-computed subtotal
 * without creating an order — currently just POST /api/checkout/discount's
 * live coupon preview — can reuse the exact same re-pricing/stock/status
 * checks as real checkout, instead of a second, drift-prone copy of this
 * logic.
 */
export async function repriceLines(items: CreateOrderItemInput[]): Promise<RepricedLine[]> {
  // Merge duplicate variant ids defensively — the client should already
  // dedupe cart lines, but nothing here depends on that being true.
  const quantityByVariant = new Map<string, number>();
  for (const item of items) {
    if (!item.variantId || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    quantityByVariant.set(item.variantId, (quantityByVariant.get(item.variantId) ?? 0) + item.quantity);
  }
  if (quantityByVariant.size === 0) throw new EmptyCartError();

  const variants = await db.productVariant.findMany({
    where: { id: { in: [...quantityByVariant.keys()] } },
    include: {
      product: {
        include: { images: { orderBy: { sortOrder: "asc" }, take: 1, include: { media: true } } },
      },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const lines: RepricedLine[] = [];
  for (const [variantId, quantity] of quantityByVariant) {
    const variant = variantById.get(variantId);
    if (!variant || !variant.active || variant.product.status !== "ACTIVE") {
      throw new InvalidVariantError(variantId);
    }
    if (variant.stock < quantity) {
      throw new OutOfStockError(variantId, variant.product.name, quantity, variant.stock);
    }

    // The variant's own price override wins when set; otherwise fall back
    // to the product's base price. Never read a price from `items`.
    const unitPrice = variant.price !== null ? Number(variant.price) : Number(variant.product.price);

    lines.push({
      variantId,
      productName: variant.product.name,
      variantLabel: `${variant.size} / ${variant.color}`,
      sku: variant.sku,
      unitPrice,
      quantity,
      imageUrl: variant.product.images[0]?.media.url ?? null,
    });
  }

  return lines;
}

export async function createOrderFromCart(input: CreateOrderFromCartInput): Promise<CreatedOrder> {
  if (!input.items || input.items.length === 0) {
    throw new EmptyCartError();
  }

  const lines = await repriceLines(input.items);

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const [flatRate, freeAbove] = await Promise.all([
    getSetting("shipping.flatRate"),
    getSetting("shipping.freeAbove"),
  ]);
  // Release-hardening F7 design decision: the free-shipping threshold is
  // evaluated against the pre-discount subtotal — a coupon never costs a
  // shopper free shipping they already earned by cart size. Evaluating it
  // post-discount would only ever be worse for the customer (a discount
  // can only lower the subtotal, never raise it), which is a punitive,
  // surprising interaction ("I applied a code and now shipping costs
  // extra") and would also invite an odd feedback loop between the two
  // settings. Keeping this line exactly as it was before discounts existed
  // means shipping and discount are independent line items computed from
  // the same source subtotal, in the order they're displayed in the
  // summary — simplest to reason about, and matches how most real
  // ecommerce free-shipping thresholds work (keyed to merchandise value,
  // not the post-coupon total).
  const shipping = subtotal >= freeAbove ? 0 : flatRate;

  // Fast, non-authoritative pre-check (see resolveDiscount's doc comment) —
  // the actual cap enforcement happens inside the transaction below via
  // commitDiscountRedemption. A code the client supplies is looked up and
  // re-priced fresh from the DB every time; no amount the client sends is
  // ever read.
  const resolvedDiscount: ResolvedDiscount | null = input.discountCode
    ? await resolveDiscount(input.discountCode, subtotal, input.email)
    : null;
  const discount = resolvedDiscount?.amount ?? 0;
  const total = subtotal + shipping - discount;
  const initialStatus = input.paymentMethod === "ORDER_REQUEST" ? "PROCESSING" : "PENDING_PAYMENT";

  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt++) {
    const number = generateOrderNumberCandidate();
    // Generated fresh on every attempt (not hoisted above the loop) so a
    // P2002 retry — astronomically unlikely to ever be *this* column, see
    // the schema comment on Order.accessTokenHash, but cheap to make moot
    // either way — can never retry with a stale token tied to an
    // abandoned candidate row.
    const accessToken = generateOrderAccessToken();
    const accessTokenHash = hashOrderAccessToken(accessToken);

    try {
      const order = await db.$transaction(async (tx) => {
        // Re-validate and decrement stock for ORDER_REQUEST orders inside
        // the same transaction as the create, closing the race between the
        // read above and this write (two concurrent order-requests for the
        // last unit can't both succeed). Razorpay orders decrement later,
        // once payment is actually verified.
        if (input.paymentMethod === "ORDER_REQUEST") {
          for (const line of lines) {
            const result = await tx.productVariant.updateMany({
              where: { id: line.variantId, stock: { gte: line.quantity } },
              data: { stock: { decrement: line.quantity } },
            });
            if (result.count === 0) {
              const current = await tx.productVariant.findUnique({ where: { id: line.variantId } });
              throw new OutOfStockError(
                line.variantId,
                line.productName,
                line.quantity,
                current?.stock ?? 0,
              );
            }
          }
        }

        const created = await tx.order.create({
          data: {
            number,
            accessTokenHash,
            // F-01: never a fabricated/looked-up value — undefined for a
            // guest (Order.customerId simply stays null), or the real
            // session id for a logged-in shopper. email/phone below are
            // always exactly what was typed and validated by
            // checkoutSchema, never substituted.
            customerId: input.customerId,
            email: input.email,
            phone: input.phone,
            shippingAddress: input.shippingAddress as unknown as Prisma.InputJsonValue,
            subtotal,
            shipping,
            discount,
            discountId: resolvedDiscount?.id,
            discountCode: resolvedDiscount?.code,
            total,
            currency: "INR",
            status: initialStatus,
            paymentMethod: input.paymentMethod,
            items: {
              create: lines.map((line) => ({
                variantId: line.variantId,
                productName: line.productName,
                variantLabel: line.variantLabel,
                sku: line.sku,
                unitPrice: line.unitPrice,
                quantity: line.quantity,
                imageUrl: line.imageUrl,
              })),
            },
          },
        });

        // ORDER_REQUEST has no later payment step to defer to (same reason
        // its stock decrement above happens immediately too) — commit the
        // redemption now, in the same transaction, so a cap violation rolls
        // back the whole order rather than ever being created unredeemed.
        // RAZORPAY defers this to the PAID transition (/api/checkout/verify
        // and the webhook) — see this module's header comment.
        if (resolvedDiscount && input.paymentMethod === "ORDER_REQUEST") {
          const commit = await commitDiscountRedemption(tx, {
            discountId: resolvedDiscount.id,
            maxRedemptions: resolvedDiscount.maxRedemptions,
            maxRedemptionsPerCustomer: resolvedDiscount.maxRedemptionsPerCustomer,
            orderId: created.id,
            email: input.email,
            customerId: input.customerId ?? null,
          });
          if (!commit.ok) {
            throw commit.reason === "already_used"
              ? new DiscountAlreadyUsedError()
              : new DiscountUsageLimitReachedError();
          }
        }

        return created;
      });

      return {
        id: order.id,
        number: order.number,
        accessToken,
        subtotal,
        shipping,
        discount,
        discountCode: resolvedDiscount?.code ?? null,
        total,
        currency: order.currency,
        status: order.status,
        paymentMethod: input.paymentMethod,
        email: order.email,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Order.number collision — retry with a fresh candidate.
        continue;
      }
      throw error;
    }
  }

  throw new OrderNumberGenerationError();
}
