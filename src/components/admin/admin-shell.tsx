"use client";

import { cn } from "@/lib/utils";
import {
  BarChart3,
  Bell,
  Bot,
  ClipboardList,
  FileText,
  GitBranch,
  Globe,
  LayoutDashboard,
  LayoutTemplate,
  LineChart,
  LogOut,
  Mail,
  Megaphone,
  MessageSquareQuote,
  Package,
  Plug,
  Star,
  ScrollText,
  Search,
  Tag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth/session";
import { formatRole, hasPermission, type Permission } from "@/lib/auth/rbac";

const navItems: { href: string; label: string; icon: typeof LayoutDashboard; permission: Permission }[] = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
  { href: "/admin/reports", label: "Reports", icon: BarChart3, permission: "dashboard:view" },
  { href: "/admin/homepage", label: "Homepage", icon: LayoutTemplate, permission: "homepage:manage" },
  { href: "/admin/blog", label: "Blog", icon: FileText, permission: "blog:manage" },
  { href: "/admin/bulk-orders", label: "Bulk Orders", icon: ClipboardList, permission: "bulk-orders:manage" },
  { href: "/admin/orders", label: "Orders", icon: Package, permission: "bulk-orders:manage" },
  { href: "/admin/contact-enquiries", label: "Contact", icon: Mail, permission: "bulk-orders:manage" },
  { href: "/admin/engagement", label: "Engagement", icon: Megaphone, permission: "engagement:manage" },
  { href: "/admin/journeys", label: "Journeys", icon: GitBranch, permission: "journeys:manage" },
  { href: "/admin/intelligence", label: "Intelligence", icon: LineChart, permission: "intelligence:view" },
  { href: "/admin/reputation", label: "Reputation", icon: Star, permission: "intelligence:view" },
  { href: "/admin/market", label: "Market", icon: Globe, permission: "market:view" },
  { href: "/admin/offers", label: "Offers", icon: Tag, permission: "offers:manage" },
  { href: "/admin/seo", label: "SEO", icon: Search, permission: "seo:manage" },
  { href: "/admin/hermes", label: "Hermes", icon: Bot, permission: "hermes:manage" },
  { href: "/admin/integrations", label: "Integrations", icon: Plug, permission: "integrations:manage" },
  { href: "/admin/notifications", label: "Notifications", icon: Bell, permission: "bulk-orders:manage" },
  { href: "/admin/testimonials", label: "Testimonials", icon: MessageSquareQuote, permission: "testimonials:manage" },
  { href: "/admin/users", label: "Users", icon: Users, permission: "users:manage" },
  { href: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText, permission: "audit:view" },
];

export function AdminShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  };

  const visibleNav = navItems.filter((item) => hasPermission(user.role, item.permission));

  return (
    <div className="min-h-screen bg-lavender/40">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-white p-6 lg:block">
          <Link href="/admin/dashboard" className="font-display text-xl font-extrabold text-brand">
            DAAKYKA Admin
          </Link>
          <p className="mt-1 text-xs text-muted">{formatRole(user.role)}</p>

          <nav className="mt-8 space-y-1">
            {visibleNav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  pathname === href || pathname.startsWith(`${href}/`)
                    ? "bg-brand/10 text-brand"
                    : "text-muted hover:bg-lilac/40 hover:text-ink",
                )}
              >
                <Icon size={18} />
                {label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-8 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </aside>

        <div className="flex-1">
          <header className="border-b border-border bg-white px-4 py-4 lg:px-8">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-brand">Admin Panel</p>
                <p className="font-display text-lg font-bold text-ink">{user.name}</p>
              </div>
              <Link href="/" className="text-sm font-semibold text-brand hover:underline">
                View Storefront
              </Link>
            </div>
          </header>
          <main className="p-4 lg:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
