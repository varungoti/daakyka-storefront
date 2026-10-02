import { NextResponse } from "next/server";
import { isUniqueLocalCartId } from "@/lib/cart/service";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { z } from "zod";

// F-072: this is a public, unauthenticated beacon (navigator.sendBeacon
// from cart-abandon-tracker.tsx) — it must never accept an identity to
// contact. The real tracker never sends one (see the payload it builds
// below); a caller supplying `email` here was the only way this endpoint
// was reachable at all, letting anyone enrol any address in the marketing
// Abandoned Cart journey with no consent and no unsubscribe link. If
// abandoned-cart email ever becomes a real feature, it needs to be derived
// server-side from a proven, consenting identity — never taken from the
// request body.
const schema = z.object({
  // F-122: must be a real per-browser `local-<uuid>` — the retired shared
  // "local-cart" sentinel (every cart used to carry it) would otherwise make
  // the one-hour dedupe below swallow every shopper after the first.
  cartId: z.string().max(200).refine(isUniqueLocalCartId, "Invalid cart id"),
  subtotal: z.number().optional(),
  itemCount: z.number().int().min(1),
  items: z.array(z.object({ title: z.string(), quantity: z.number() })).optional(),
});

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "cart-abandon", 10, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = schema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    // cartId is now required (the real tracker always sends it), so this
    // dedup can no longer match "any event in the last hour" the way
    // `cartId: undefined` used to when the field was optional.
    const recent = await db.cartAbandonmentEvent.findFirst({
      where: {
        cartId: parsed.data.cartId,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent) {
      return NextResponse.json({ message: "Already recorded", id: recent.id });
    }

    const event = await db.cartAbandonmentEvent.create({
      data: {
        cartId: parsed.data.cartId,
        subtotal: parsed.data.subtotal,
        itemCount: parsed.data.itemCount,
        metadata: parsed.data.items ? JSON.stringify(parsed.data.items) : null,
      },
    });

    return NextResponse.json({ id: event.id, message: "Abandonment recorded" });
  } catch {
    return NextResponse.json({ error: "Failed to record abandonment" }, { status: 500 });
  }
}
