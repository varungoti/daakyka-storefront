import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { z } from "zod";

const schema = z.object({
  email: z.string().email().optional(),
  cartId: z.string().optional(),
  subtotal: z.number().optional(),
  itemCount: z.number().int().min(1),
  items: z.array(z.object({ title: z.string(), quantity: z.number() })).optional(),
});

export async function POST(request: Request) {
  const limited = rateLimitOrResponse(request, "cart-abandon", 10, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = schema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const recent = await db.cartAbandonmentEvent.findFirst({
      where: {
        cartId: parsed.data.cartId ?? undefined,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent) {
      return NextResponse.json({ message: "Already recorded", id: recent.id });
    }

    const event = await db.cartAbandonmentEvent.create({
      data: {
        email: parsed.data.email,
        cartId: parsed.data.cartId,
        subtotal: parsed.data.subtotal,
        itemCount: parsed.data.itemCount,
        metadata: parsed.data.items ? JSON.stringify(parsed.data.items) : null,
      },
    });

    if (parsed.data.email) {
      const { triggerJourneys } = await import("@/lib/engagement/journey-engine");
      await triggerJourneys("cart_abandoned", { email: parsed.data.email });
    }

    return NextResponse.json({ id: event.id, message: "Abandonment recorded" });
  } catch {
    return NextResponse.json({ error: "Failed to record abandonment" }, { status: 500 });
  }
}
