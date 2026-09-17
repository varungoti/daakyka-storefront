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
  Image as ImageIcon,
  LayoutDashboard,
  LayoutTemplate,
  LineChart,
  LogOut,
  Mail,
  Megaphone,
  MessageSquareQuote,
  Menu,
  Package,
  Plug,
  Ruler,
  Star,
  ScrollText,
  Search,
  Sliders,
  Tag,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth/session";
import { formatRole, hasPermission, type Permission } from "@/lib/auth/rbac";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: Permission;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
      { href: "/admin/reports", label: "Reports", icon: BarChart3, permission: "dashboard:view" },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/admin/products", label: "Products", icon: Package, permission: "products:view" },
      { href: "/admin/categories", label: "Categories", icon: Tag, permission: "categories:manage" },
      { href: "/admin/size-charts", label: "Size Charts", icon: Ruler, permission: "categories:manage" },
      { href: "/admin/media", label: "Media", icon: ImageIcon, permission: "media:manage" },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: Package, permission: "orders:view" },
      { href: "/admin/customers", label: "Customers", icon: Users, permission: "customers:view" },
      { href: "/admin/bulk-orders", label: "Bulk Enquiries", icon: ClipboardList, permission: "bulk-orders:manage" },
      { href: "/admin/contact-enquiries", label: "Contact Enquiries", icon: Mail, permission: "bulk-orders:manage" },
      { href: "/admin/reviews", label: "Reviews", icon: Star, permission: "reviews:moderate" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { href: "/admin/engagement", label: "Engagement", icon: Megaphone, permission: "engagement:manage" },
      { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone, permission: "engagement:manage" },
      { href: "/admin/journeys", label: "Journeys", icon: GitBranch, permission: "journeys:manage" },
      { href: "/admin/offers", label: "Offers", icon: Tag, permission: "offers:manage" },
      { href: "/admin/testimonials", label: "Testimonials", icon: MessageSquareQuote, permission: "testimonials:manage" },
      { href: "/admin/market", label: "Market", icon: Globe, permission: "market:view" },
      { href: "/admin/intelligence", label: "Intelligence", icon: LineChart, permission: "intelligence:view" },
      { href: "/admin/reputation", label: "Reputation", icon: Star, permission: "intelligence:view" },
      { href: "/admin/hermes", label: "Hermes", icon: Bot, permission: "hermes:manage" },
    ],
  },
  {
    label: "Content",
    items: [
      { href: "/admin/homepage", label: "Homepage", icon: LayoutTemplate, permission: "homepage:manage" },
      { href: "/admin/blog", label: "Blog", icon: FileText, permission: "blog:manage" },
      { href: "/admin/seo", label: "SEO", icon: Search, permission: "seo:manage" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/admin/site-controls", label: "Site Controls", icon: Sliders, permission: "settings:manage" },
      { href: "/admin/integrations", label: "Integrations", icon: Plug, permission: "integrations:manage" },
      { href: "/admin/users", label: "Users", icon: Users, permission: "users:manage" },
      { href: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText, permission: "audit:view" },
      { href: "/admin/notifications", label: "Notifications", icon: Bell, permission: "bulk-orders:manage" },
    ],
  },
];

function NavLinks({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="mt-8 space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-muted/70">{group.label}</p>
          <div className="mt-2 space-y-1">
            {group.items.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
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
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Full-screen mobile nav drawer (shown below `lg`, where the sidebar is
 * hidden). Traps focus while open, closes on Escape, and returns focus to
 * the hamburger trigger on close. */
function MobileNavDrawer({
  open,
  onClose,
  groups,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  groups: NavGroup[];
  pathname: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <Link href="/admin/dashboard" className="font-display text-xl font-extrabold text-brand" onClick={onClose}>
            DAAKYKA Admin
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-lg p-2 text-muted hover:bg-lilac/40 hover:text-ink"
          >
            <X size={20} />
          </button>
        </div>
        <NavLinks groups={groups} pathname={pathname} onNavigate={onClose} />
      </div>
    </div>
  );
}

export function AdminShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  };

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasPermission(user.role, item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-lavender/40">
      <div className="mx-auto flex min-h-screen max-w-7xl">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-surface p-6 lg:block">
          <Link href="/admin/dashboard" className="font-display text-xl font-extrabold text-brand">
            DAAKYKA Admin
          </Link>
          <p className="mt-1 text-xs text-muted">{formatRole(user.role)}</p>

          <NavLinks groups={visibleGroups} pathname={pathname} />

          <button
            type="button"
            onClick={handleLogout}
            className="mt-8 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-red-50 hover:text-red-600"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </aside>

        <MobileNavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          groups={visibleGroups}
          pathname={pathname}
        />

        <div className="flex-1">
          <header className="border-b border-border bg-surface px-4 py-4 lg:px-8">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open navigation"
                  className="rounded-lg p-2 text-muted hover:bg-lilac/40 hover:text-ink lg:hidden"
                >
                  <Menu size={22} />
                </button>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand">Admin Panel</p>
                  <p className="font-display text-lg font-bold text-ink">{user.name}</p>
                </div>
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
