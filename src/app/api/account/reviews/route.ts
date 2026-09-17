import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";

/** The customer's own reviews across every status (PENDING/APPROVED/
 * REJECTED) — unlike the public product review list, which only ever
 * shows APPROVED ones. Scoped to the caller's session id; there is no way
 * to pass another customerId in. Review submission itself is D2, so this
 * will legitimately return an empty list until that lands. */
export async function GET() {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reviews = await db.review.findMany({
    where: { customerId: session.id },
    orderBy: { createdAt: "desc" },
    include: {
      product: { select: { name: true, slug: true } },
    },
  });

  return NextResponse.json({ reviews });
}
