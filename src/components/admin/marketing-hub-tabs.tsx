"use client";

import Link from "next/link";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Bot, GitBranch, Globe, LineChart, Megaphone, MessageSquareQuote, Percent, Star, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MarketingHubSection {
  key: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

/**
 * F-10 (docs/audit-2026-09-19/admin-ux.md): the full content for every
 * Marketing tab, including its icon component. Deliberately defined here
 * (client-side), not in the server page — a lucide-react icon is a
 * function/component, and Next.js's RSC boundary refuses to serialize a
 * function passed as a prop from a Server Component to a Client Component
 * ("Functions cannot be passed directly to Client Components"). The server
 * page (marketing/page.tsx) only needs to decide *which* of these keys a
 * given admin can see (a permission check, which only it can do — it has
 * the session); it passes that as a plain array of key strings, and this
 * component does the actual lookup against the list below.
 */
const ALL_SECTIONS: MarketingHubSection[] = [
  {
    key: "engagement",
    label: "Engagement",
    description: "Customer segments, message templates, and campaign workflows.",
    href: "/admin/engagement",
    icon: Megaphone,
  },
  {
    key: "campaigns",
    label: "Campaigns",
    description: "Draft campaigns require approval before send — no messages are dispatched automatically yet.",
    href: "/admin/campaigns",
    icon: Megaphone,
  },
  {
    key: "journeys",
    label: "Journeys",
    description:
      "Automated email and WhatsApp sequences — journeys never auto-send without a provider connection and campaign approval.",
    href: "/admin/journeys",
    icon: GitBranch,
  },
  {
    key: "offers",
    label: "Offers",
    description: "Bundle, shipping, first-purchase, and institutional offers — approval required before storefront activation.",
    href: "/admin/offers",
    icon: Tag,
  },
  {
    key: "discounts",
    label: "Discount Codes",
    description: "Create and manage coupon codes redeemable at checkout.",
    href: "/admin/discounts",
    icon: Percent,
  },
  {
    key: "testimonials",
    label: "Testimonials",
    description: "Manage customer quotes shown on the homepage and shop.",
    href: "/admin/testimonials",
    icon: MessageSquareQuote,
  },
  {
    key: "market",
    label: "Market",
    description: "Competitor observations and category trends — expand with Hermes weekly scans.",
    href: "/admin/market",
    icon: Globe,
  },
  {
    key: "intelligence",
    label: "Intelligence",
    description: "Catalog insights from the product database — expand with analytics when connected.",
    href: "/admin/intelligence",
    icon: LineChart,
  },
  {
    key: "reputation",
    label: "Reputation",
    description: "Testimonials, product ratings, and review gaps — pair with post-purchase journeys for review requests.",
    href: "/admin/reputation",
    icon: Star,
  },
  {
    key: "hermes",
    label: "Hermes",
    description:
      'Autonomous marketing agent — every workflow run lands in an approval queue, "SUGGEST ONLY" by default; see the Hermes page itself for exactly what each workflow does.',
    href: "/admin/hermes",
    icon: Bot,
  },
];

/**
 * Tabbed hub for the Marketing group, which used to be 9 (now 10, with
 * Discount Codes) separate top-level sidebar links — see admin-shell.tsx,
 * which now points the sidebar at this single `/admin/marketing` page
 * instead.
 *
 * Deliberately a directory, not a re-implementation: each of those pages
 * already has its own real data-fetching, forms, and actions, and none of
 * that changed or moved. Nothing here deletes, hides, or disables a page —
 * every one of them is still reachable directly by URL, unchanged; this is
 * only a navigation affordance so the sidebar isn't the thing listing all
 * 10 (release-hardening constraint: the store owner hasn't decided whether
 * to hide any of these modules yet, so nothing here forecloses that
 * decision either way).
 */
export function MarketingHubTabs({ visibleKeys }: { visibleKeys: string[] }) {
  const visibleSet = new Set(visibleKeys);
  const sections = ALL_SECTIONS.filter((section) => visibleSet.has(section.key));
  const [activeKey, setActiveKey] = useState(sections[0]?.key);
  const active = sections.find((s) => s.key === activeKey) ?? sections[0];

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Marketing sections" className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            role="tab"
            aria-selected={section.key === active.key}
            onClick={() => setActiveKey(section.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition",
              section.key === active.key ? "bg-brand text-white" : "text-muted hover:bg-lilac/40 hover:text-ink",
            )}
          >
            <section.icon size={14} />
            {section.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-brand/10 p-3 text-brand">
            <active.icon size={22} />
          </div>
          <div className="flex-1 space-y-3">
            <h2 className="font-display text-xl font-bold text-ink">{active.label}</h2>
            <p className="max-w-2xl text-sm text-muted">{active.description}</p>
            <Link
              href={active.href}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand/90"
            >
              Open {active.label}
              <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
