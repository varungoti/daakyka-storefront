import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  getOrderForAdmin,
  MissingTrackingInfoError,
  OrderNotFoundError,
  orderUpdateSchema,
  updateOrderAdmin,
} from "@/lib/orders/admin-orders";
import { InvalidOrderStatusTransitionError } from "@/lib/orders/status-transitions";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("orders:view");
  if (error) return error;

  const { id } = await params;
  try {
    const order = await getOrderForAdmin(id);
    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof OrderNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("orders:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = orderUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await updateOrderAdmin(id, parsed.data, session.id);
    // Re-fetch through the same serializer GET uses, so Decimal money
    // fields come back as numbers (not Prisma's stringified Decimal) and
    // the response includes items/customer like every other read of an
    // order — one consistent shape for callers instead of two.
    const order = await getOrderForAdmin(id);
    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof OrderNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (err instanceof InvalidOrderStatusTransitionError || err instanceof MissingTrackingInfoError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
