import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { getHermesRuntimeInfo } from "@/lib/hermes/runtime/router";

export const runtime = "nodejs";

/**
 * F4 fix: {service, platform, fireworks, inline, mode} maps this
 * deployment's Hermes/AI attack surface to any unauthenticated caller
 * (e.g. confirms Vercel hosting, whether Fireworks is wired up) — free
 * recon with no auth required (docs/audit-2026-09-19/security.md, F4).
 * scripts/probe-deploy.mjs and tests/e2e/dogfood.spec.ts only need `ok`
 * and `service` for liveness, so those two stay public; the rest now
 * requires an authenticated admin with "hermes:manage" (the same
 * permission src/app/api/admin/hermes/** routes require).
 */
export async function GET() {
  const { session } = await requireAdminPermission("hermes:manage");
  const timestamp = new Date().toISOString();

  if (!session) {
    return NextResponse.json({ ok: true, service: "daakyka-hermes", timestamp });
  }

  return NextResponse.json({ ok: true, ...getHermesRuntimeInfo(), timestamp });
}
