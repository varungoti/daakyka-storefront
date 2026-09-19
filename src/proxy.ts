import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";

/**
 * F7 (docs/audit-2026-09-19/security.md): coarse, DB-free admin gate —
 * intentionally, not by oversight.
 *
 * This checks LESS than src/lib/auth/session.ts's verifySessionToken():
 * it verifies the JWT's signature, expiry, and claim shape, but — unlike
 * verifySessionToken — never checks `user.active` or the `sessionVersion`
 * revocation claim against the database, so a token for a since-
 * deactivated admin, or one revoked by "log out everywhere", still
 * passes here until it naturally expires (up to 7 days).
 *
 * Why not just call verifySessionToken() here instead:
 *
 * 1. Next.js 16 always runs Proxy (formerly Middleware) on the Node.js
 *    runtime now — the `runtime` export isn't even settable in a proxy
 *    file anymore, it throws if you try
 *    (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md,
 *    "Runtime") — so a Prisma call is *technically* reachable here,
 *    unlike the old Edge-runtime middleware this replaced. But Next's
 *    own docs are explicit that Proxy "is not intended for slow data
 *    fetching... it should not be used as a full session management or
 *    authorization solution" and that, especially on Vercel, it "can run
 *    outside of your application's main runtime" for fast
 *    redirect/rewrite handling
 *    (node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 *    Adding a DB round trip (and Prisma connection-pool pressure) to
 *    *every* /admin and /api/admin request — including the vast
 *    majority that are already correctly authorized — to shave the
 *    small window before the real check below runs is the wrong trade.
 * 2. That real check always runs immediately afterward, on every path
 *    that matters, and is what this codebase actually relies on for
 *    authorization: src/app/admin/(panel)/layout.tsx calls getSession()
 *    (the full, DB-backed, sessionVersion-checked verify) before
 *    rendering any admin page, and every admin API route under
 *    src/app/api/admin/ calls requireAdminPermission() -> getSession()
 *    before doing anything — statically enforced by
 *    src/lib/auth/admin-routes-guarded.test.ts, so no admin API route
 *    can ship without it. A revoked session that slips past this gate
 *    is redirected/401'd one hop later, before any admin data is ever
 *    read or rendered (see src/lib/auth/admin-security.test.ts).
 *
 * The one improvement made here: this now also validates the token's
 * claim SHAPE (a non-empty `sub` and a numeric `sv`) — cheaply, with no
 * DB call — matching verifySessionToken's own pre-DB shape check, so a
 * malformed or foreign token that happens to verify against the same
 * secret but is missing these claims is rejected here too, not just
 * downstream.
 *
 * If this ever becomes the *sole* authorization check for some future
 * route (rather than the coarse pre-filter it is today), it must be
 * upgraded to call verifySessionToken directly instead.
 */
async function verifyAdminToken(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;

  if (!token || !secret) {
    return false;
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    return typeof payload.sub === "string" && payload.sub.length > 0 && typeof payload.sv === "number";
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin/login")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/admin")) {
    const authorized = await verifyAdminToken(request);
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    const authorized = await verifyAdminToken(request);
    if (!authorized) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
