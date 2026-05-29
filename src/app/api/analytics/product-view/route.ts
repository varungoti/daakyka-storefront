import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { z } from "zod";

const schema = z.object({
  productHandle: z.string().min(1),
  productName: z.string().optional(),
  sessionId: z.string().optional(),
});

export async function POST(request: Request) {
  const limited = rateLimitOrResponse(request, "product-view", 60, 60_000);
  if (limited) return limited;

  try {
    const bodyResult = await readJsonBody(request);
    if (!bodyResult.ok) return bodyResult.response;
    const parsed = schema.safeParse(bodyResult.data);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    await db.productViewEvent.create({
      data: {
        productHandle: parsed.data.productHandle,
        productName: parsed.data.productName,
        sessionId: parsed.data.sessionId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
  }
}
