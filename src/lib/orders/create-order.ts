import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getSetting } from "@/lib/settings";
import type { ShippingAddressInput } from "@/lib/validation/schemas";
import {
  generateOrderNumberCandidate,
  MAX_ORDER_NUMBER_ATTEMPTS,
  OrderNumberGenerationError,
} from "@/lib/orders/number";

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
}

export interface CreatedOrder {
  id: string;
  number: string;
  subtotal: number;
  shipping: number;
  discount: number;
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

interface RepricedLine {
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
}

async function repriceLines(items: CreateOrderItemInput[]): Promise<RepricedLine[]> {
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
  const shipping = subtotal >= freeAbove ? 0 : flatRate;
  const discount = 0;
  const total = subtotal + shipping - discount;
  const initialStatus = input.paymentMethod === "ORDER_REQUEST" ? "PROCESSING" : "PENDING_PAYMENT";

  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_ATTEMPTS; attempt++) {
    const number = generateOrderNumberCandidate();

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

        return tx.order.create({
          data: {
            number,
            customerId: input.customerId,
            email: input.email,
            phone: input.phone,
            shippingAddress: input.shippingAddress as unknown as Prisma.InputJsonValue,
            subtotal,
            shipping,
            discount,
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
      });

      return {
        id: order.id,
        number: order.number,
        subtotal,
        shipping,
        discount,
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
