import { NextResponse } from "next/server";
import {
  BackInStockVariantInStockError,
  BackInStockVariantNotFoundError,
  subscribeToBackInStock,
} from "@/lib/back-in-stock";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { backInStockSubscribeSchema } from "@/lib/validation/schemas";

/**
 * Shopify-parity gap: "Notify me when available" signup for a sold-out
 * variant. See src/lib/back-in-stock/index.ts for the restock-detection
 * design (a cron sweep, not a hook at every stock write site) and the
 * de-dupe/anti-abuse story.
 *
 * Always returns the same generic success shape regardless of whether this
 * was a fresh signup or a duplicate of an existing pending one — never
 * reveals whether a given email had already registered for this variant.
 */
export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "back-in-stock", 10, 60_000);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = backInStockSubscribeSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await subscribeToBackInStock(parsed.data.variantId, parsed.data.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BackInStockVariantNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof BackInStockVariantInStockError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
