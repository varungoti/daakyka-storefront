import { redirect } from "next/navigation";
import { MarketingHubTabs } from "@/components/admin/marketing-hub-tabs";
import { hasPermission, type Permission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Marketing" };

/**
 * F-10 (docs/audit-2026-09-19/admin-ux.md): which permission each Marketing
 * section requires — mirrors exactly the per-item permissions
 * admin-shell.tsx used before the sidebar collapsed these into one
 * "Marketing" link. The section *content* (label, description, href, icon)
 * lives in marketing-hub-tabs.tsx, a Client Component — a lucide-react
 * icon is a function, and Next.js's server/client boundary can't
 * serialize a function passed as a prop, so this page only ever hands the
 * client component a plain array of key strings it's allowed to see.
 */
const SECTION_PERMISSIONS: Record<string, Permission> = {
  engagement: "engagement:manage",
  campaigns: "engagement:manage",
  journeys: "journeys:manage",
  offers: "offers:manage",
  discounts: "offers:manage",
  testimonials: "testimonials:manage",
  market: "market:view",
  intelligence: "intelligence:view",
  reputation: "intelligence:view",
  hermes: "hermes:manage",
};

export default async function AdminMarketingHubPage() {
  const session = await getSession();
  if (!session) redirect("/admin/dashboard");

  const visibleKeys = Object.entries(SECTION_PERMISSIONS)
    .filter(([, permission]) => hasPermission(session.role, permission))
    .map(([key]) => key);
  if (visibleKeys.length === 0) redirect("/admin/dashboard");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Marketing</h1>
        <p className="text-muted">
          Everything for reaching and keeping customers in one place: subscribers and segments, campaigns, automated
          journeys, offers, discount codes, testimonials, market and product insights, reputation, and the Hermes
          assistant. Pick a section below, then open it to manage it.
        </p>
      </div>
      <MarketingHubTabs visibleKeys={visibleKeys} />
    </div>
  );
}
