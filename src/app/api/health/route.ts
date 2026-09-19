import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { getIntegrationStatuses } from "@/lib/integrations/status";
import { getProductSource } from "@/lib/products/index";

/**
 * F4 fix: this route has no auth by design — it's the liveness probe
 * monitoring/CI hits before any admin session exists (see
 * scripts/probe-deploy.mjs, scripts/predeploy-verify.mjs,
 * scripts/verify-101.mjs — all of which only need `status`/`res.ok`).
 * It must therefore never hand an unauthenticated caller a map of which
 * third-party integrations are (or aren't) configured — that's free
 * recon of the app's attack surface (docs/audit-2026-09-19/security.md,
 * F4). Every caller still gets the DB-connectivity liveness signal
 * (`status`); only an authenticated admin with "integrations:manage"
 * (the same permission src/app/api/admin/integrations/[provider]/route.ts
 * requires) also gets the catalog source and per-provider statuses.
 *
 * Calling requireAdminPermission() outside a real Next.js request (as
 * the unauthenticated-shape regression test in
 * tests/integration/api-routes.test.ts does) makes getSession() fail
 * closed (cookies() throws, caught, returns null) — the same harness
 * limitation documented in tests/integration/admin-auth.test.ts — which
 * conveniently exercises exactly the "no session" branch below rather
 * than needing a live server.
 */
export async function GET() {
  try {
    await db.user.count();

    const { session } = await requireAdminPermission("integrations:manage");
    if (!session) {
      return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
    }

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      catalog: getProductSource(),
      integrations: (await getIntegrationStatuses()).map((item) => ({
        provider: item.provider,
        status: item.status,
      })),
    });
  } catch {
    return NextResponse.json(
      { status: "error", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
