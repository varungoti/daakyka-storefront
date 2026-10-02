import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { ErasureBlockedError, erasePersonalData } from "@/lib/privacy/erase";
import { readJsonBody } from "@/lib/security/parse-json-body";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const eraseSchema = z.object({
  /** The customer's email, typed out — erasure is irreversible. */
  confirmEmail: z.string().trim().min(1).max(254),
  /** Erase even though an order is still being fulfilled. */
  includeOpenOrders: z.boolean().optional(),
});

/**
 * F-315: "Erase personal data" for one customer — the Customer row, every
 * enquiry, lead, subscription, journey and email-log row tied to their
 * address, and anonymises (never deletes) their orders so tax records stay
 * whole. See src/lib/privacy/erase.ts. Requires the typed email as
 * confirmation; refuses (409) while an order is still being processed unless
 * the caller explicitly includes open orders.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("privacy:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = eraseSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const customer = await db.customer.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }
  if (parsed.data.confirmEmail.toLowerCase() !== customer.email.toLowerCase()) {
    return NextResponse.json({ error: "The email you typed does not match this customer." }, { status: 400 });
  }

  try {
    const report = await erasePersonalData(
      { customerId: customer.id },
      { actorUserId: session.id, source: "admin", includeOpenOrders: parsed.data.includeOpenOrders },
    );
    return NextResponse.json({ ok: true, counts: report.counts });
  } catch (err) {
    if (err instanceof ErasureBlockedError) {
      return NextResponse.json({ error: err.message, orders: err.orderNumbers }, { status: 409 });
    }
    throw err;
  }
}
