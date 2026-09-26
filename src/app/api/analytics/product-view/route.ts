import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { z } from "zod";

// F-112 fix: matches src/lib/catalog/csv.ts's SLUG_PATTERN — a real product
// handle is always a slug shape. Before this, `productHandle` accepted any
// non-empty string and `productName` was unbounded, so an unauthenticated
// caller could POST an arbitrary handle plus a many-KB name and have it
// stored verbatim; the admin Product Intelligence page then rendered it
// straight into "Most Viewed Products". `productName` and `sessionId` are
// also bounded now so a single event row can't blow past a sane size — see
// intelligence/page.tsx for the matching read-side guard (unknown handles
// are dropped from the display rather than shown verbatim).
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const schema = z.object({
  productHandle: z.string().trim().min(1).max(160).regex(SLUG_PATTERN),
  productName: z.string().trim().max(200).optional(),
  sessionId: z.string().trim().max(64).optional(),
});

export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "product-view", 60, 60_000);
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
