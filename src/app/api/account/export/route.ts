import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { exportPersonalData } from "@/lib/privacy/export";
import { PrivacySubjectError } from "@/lib/privacy/subject";
import { identityRateLimitOrResponse } from "@/lib/security/rate-limit";

/**
 * F-315: "Download my data" — everything we hold about the signed-in
 * customer as one JSON file (profile, addresses, orders, reviews, wishlist,
 * marketing consent, enquiries, email log and more; see
 * src/lib/privacy/export.ts for the scope and what is deliberately left out).
 * Only ever the caller's own data: the customer id comes from the session,
 * never from the request, and only what the session proves is matched — rows
 * keyed to the account, plus rows keyed to its email once that email is
 * verified (an unverified account could otherwise be registered with a
 * stranger's address to read their orders). See SubjectTrust in
 * src/lib/privacy/subject.ts.
 */
export async function GET(request: Request) {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The export fans out over ~18 tables — a handful per hour is plenty.
  const limited = await identityRateLimitOrResponse(request, "account-data-export", 5, 60 * 60_000, {
    identity: session.id,
  });
  if (limited) return limited;

  let data;
  try {
    data = await exportPersonalData({ customerId: session.id }, { audience: "customer" });
  } catch (error) {
    // The account vanished between the session check and the export.
    if (error instanceof PrivacySubjectError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw error;
  }

  await logAuditEvent({
    action: "export",
    entity: "customer",
    entityId: session.id,
    metadata: { source: "self-service" },
  }).catch(() => undefined);

  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="daakyka-my-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
