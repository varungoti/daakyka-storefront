import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { triggerJourneys } from "@/lib/engagement/journey-engine";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhook-verify";

// Shopify sends every subscribed topic to the same endpoint URL, and any
// store can be configured to POST here — the HMAC alone only proves the
// payload was signed with our webhook secret, not that it came from a
// topic or shop we actually handle. Reject the rest so a misconfigured or
// malicious sender can't slip an unexpected topic (e.g. a bulk-operation
// or customer-data topic) into the order pipeline.
const ALLOWED_TOPICS = new Set(["orders/create", "orders/paid", "orders/updated", "orders/cancelled"]);

export async function POST(request: Request) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic");
  const shopDomain = request.headers.get("x-shopify-shop-domain");

  if (!verifyShopifyWebhookHmac(rawBody, hmac)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const expectedDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  if (expectedDomain && shopDomain !== expectedDomain) {
    return NextResponse.json({ error: "Unrecognized shop domain" }, { status: 401 });
  }

  if (!topic || !ALLOWED_TOPICS.has(topic)) {
    return NextResponse.json({ error: "Unsupported webhook topic" }, { status: 400 });
  }

  try {
    const order = JSON.parse(rawBody) as {
      id?: number;
      email?: string;
      phone?: string;
      total_price?: string;
      financial_status?: string;
      line_items?: { title: string; quantity: number }[];
    };

    const externalId = order.id ? String(order.id) : undefined;
    const existing = externalId
      ? await db.orderEvent.findUnique({ where: { externalId } })
      : null;
    if (existing) {
      return NextResponse.json({ message: "Already processed", id: existing.id });
    }

    const record = await db.orderEvent.create({
      data: {
        externalId,
        email: order.email ?? null,
        phone: order.phone ?? null,
        total: order.total_price ? parseFloat(order.total_price) : null,
        status: order.financial_status ?? "created",
        metadata: order.line_items ? JSON.stringify(order.line_items) : null,
      },
    });

    if (order.email) {
      await triggerJourneys("order_created", {
        email: order.email,
        phone: order.phone,
        firstName: order.email.split("@")[0],
      });
    }

    await db.adminNotification.create({
      data: {
        title: "New Order Received",
        body: `Order ${externalId ?? record.id} from ${order.email ?? "guest"} — post-purchase journey queued.`,
        type: "order_created",
        metadata: JSON.stringify({ orderId: externalId, total: order.total_price }),
      },
    });

    return NextResponse.json({ ok: true, id: record.id });
  } catch {
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
