"use client";

import { cn } from "@/lib/utils";
import {
  BarChart3,
  Bell,
  ClipboardList,
  FileText,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Mail,
  Megaphone,
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
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth/session";
import { formatRole, hasPermission, type Permission } from "@/lib/auth/rbac";
import { NOTIFICATIONS_PAGE_PERMISSIONS } from "@/lib/admin/notifications-access";
import { GuardedLink, useUnsavedChangesNav } from "@/components/admin/unsaved-changes";

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** An array means "visible if the user has ANY of these" — used by the
   * consolidated Marketing hub link below, which fans out to 9 pages that
   * each had their own permission before release-hardening F-10. */
  permission: Permission | Permission[];
  /** Extra path prefixes that should also highlight this link as active —
   * for the Marketing hub link, whose 10 sections live at their own
   * original URLs (e.g. `/admin/hermes`), not under `/admin/marketing/`. */
  activePrefixes?: string[];
}

const MARKETING_HUB_SECTION_PATHS = [
  "/admin/engagement",
  "/admin/campaigns",
  "/admin/journeys",
  "/admin/offers",
  "/admin/discounts",
  "/admin/testimonials",
  "/admin/market",
  "/admin/intelligence",
  "/admin/reputation",
  "/admin/hermes",
];

function canSeeNavItem(role: SessionUser["role"], permission: Permission | Permission[]): boolean {
  return Array.isArray(permission) ? permission.some((p) => hasPermission(role, p)) : hasPermission(role, permission);
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
      // F-10 (docs/audit-2026-09-19/admin-ux.md): this used to be 9 (now
      // 10, with Discount Codes) separate top-level links — collapsed
      // behind one hub with tabs (src/app/admin/(panel)/marketing/page.tsx)
      // so the sidebar isn't the thing listing every Marketing sub-area.
      // Nothing was deleted: every page below is still reachable directly
      // by its own URL, and the hub links out to each one unchanged. The
      // permission array means "show this link if the user can reach *any*
      // one of those pages" — see canSeeNavItem above; the hub page itself
      // re-checks each section's own permission before showing its tab.
      {
        href: "/admin/marketing",
        label: "Marketing",
        icon: Megaphone,
        permission: [
          "engagement:manage",
          "journeys:manage",
          "offers:manage",
          "testimonials:manage",
          "market:view",
          "intelligence:view",
          "hermes:manage",
        ],
        activePrefixes: MARKETING_HUB_SECTION_PATHS,
      },
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
      {
        href: "/admin/site-controls",
        label: "Site Controls",
        icon: Sliders,
        // F-061: MARKETING_ADMIN now holds "settings:marketing" instead of
        // the full "settings:manage" — the page itself further restricts
        // which sections that role sees (see site-controls/page.tsx).
        permission: ["settings:manage", "settings:marketing"],
      },
      { href: "/admin/integrations", label: "Integrations", icon: Plug, permission: "integrations:manage" },
      { href: "/admin/users", label: "Users", icon: Users, permission: "users:manage" },
      { href: "/admin/audit-logs", label: "Audit Logs", icon: ScrollText, permission: "audit:view" },
      // F-268: was gated on "bulk-orders:manage" alone, which hid the
      // nav item from MARKETING_ADMIN even though the page now shows it
      // its own Journey Event Log section — see
      // src/lib/admin/notifications-access.ts, which this list matches.
      { href: "/admin/notifications", label: "Notifications", icon: Bell, permission: NOTIFICATIONS_PAGE_PERMISSIONS },
    ],
  },
];

function NavLinks({
  groups,
  pathname,
  onNavigate,
  badges = {},
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
  /** href -> badge count, e.g. { "/admin/notifications": unreadNotifications }. */
  badges?: Record<string, number>;
}) {
  return (
    <nav className="mt-8 space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          {/* F-243 fix: `text-muted/70` on white is ~3.0:1, below WCAG AA's
              4.5:1 for small text — `text-muted` alone (no opacity) is
              ~5.9:1. */}
          <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-muted">{group.label}</p>
          <div className="mt-2 space-y-1">
            {group.items.map(({ href, label, icon: Icon, activePrefixes }) => {
              const matchesPrefix = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
              const isActive = matchesPrefix(href) || (activePrefixes?.some(matchesPrefix) ?? false);
              const badgeCount = badges[href] ?? 0;
              return (
                <GuardedLink
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                    isActive ? "bg-brand/10 text-brand" : "text-muted hover:bg-lilac/40 hover:text-ink",
                  )}
                >
                  <Icon size={18} />
                  <span className="flex-1">{label}</span>
                  {badgeCount > 0 && (
                    <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                </GuardedLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** F-160: the Sign Out control and role label, shared between the desktop
 * sidebar and the mobile drawer so a phone/tablet admin (below `lg`, where
 * the sidebar is `display:none`) has the same way out of a 7-day session
 * that desktop always had. */
function AdminAccountFooter({
  role,
  onLogout,
}: {
  role: SessionUser["role"];
  onLogout: () => void;
}) {
  return (
    <div>
      <p className="px-3 text-xs text-muted">{formatRole(role)}</p>
      {/* F-057: previously the only account control at all was Sign Out —
          there was nowhere to change your own password. */}
      <GuardedLink
        href="/admin/account"
        className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-lilac/40 hover:text-ink"
      >
        <KeyRound size={18} />
        Change Password
      </GuardedLink>
      <button
        type="button"
        onClick={onLogout}
        className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted hover:bg-red-50 hover:text-red-600"
      >
        <LogOut size={18} />
        Sign Out
      </button>
    </div>
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
  badges,
  role,
  onLogout,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  groups: NavGroup[];
  pathname: string;
  badges: Record<string, number>;
  role: SessionUser["role"];
  onLogout: () => void;
  /** F-244 fix: the hamburger button that opened this drawer, so closing
   * it (Escape, the × button, or picking a nav link) can return focus
   * there instead of dropping it onto `<body>`. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Captured now, not read again inside the cleanup below — by the time
    // that runs, `triggerRef.current` could in principle point at a
    // different node (React ref semantics), even though in practice this
    // ref is attached to the always-mounted hamburger button.
    const trigger = triggerRef.current;
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
      // F-244 fix: this doc comment already promised focus returns to the
      // hamburger on close, but nothing here actually did it — Escape (or
      // the × button, or a nav link's onNavigate) left focus on `<body>`.
      trigger?.focus();
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div
      id="admin-mobile-nav"
      className="fixed inset-0 z-50 lg:hidden print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Admin navigation"
    >
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-surface p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <GuardedLink href="/admin/dashboard" className="font-display text-xl font-extrabold text-brand" onClick={onClose}>
            DAAKYKA Admin
          </GuardedLink>
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
        <NavLinks groups={groups} pathname={pathname} onNavigate={onClose} badges={badges} />
        <div className="mt-8 border-t border-border pt-4">
          <AdminAccountFooter role={role} onLogout={onLogout} />
        </div>
      </div>
    </div>
  );
}

export function AdminShell({
  user,
  children,
  unreadNotifications = 0,
  pendingReviews = 0,
  mustChangePassword = false,
}: {
  user: SessionUser;
  children: React.ReactNode;
  unreadNotifications?: number;
  /** F-297: sidebar badge for pending reviews, mirroring the notifications badge. */
  pendingReviews?: number;
  /** F-057: set on an admin-issued temp password (invite or reset) —
   * see src/lib/auth/user-admin.ts. While true, every page but the
   * account page itself redirects here instead of rendering, so a fresh
   * invite or reset can't be put off indefinitely. */
  mustChangePassword?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // F-057: server-redirect (the (panel) layout also gates this) would be
  // cleaner, but SessionUser/the JWT don't carry mustChangePassword (it's
  // a DB-only flag — see the layout's own query) and every page under
  // (panel) renders through this one client shell, so enforcing it here
  // covers every current and future page the same way canSeeNavItem
  // already covers every nav link.
  useEffect(() => {
    if (mustChangePassword && pathname !== "/admin/account") {
      router.replace("/admin/account?required=1");
    }
  }, [mustChangePassword, pathname, router]);

  // F-297: generalized from the old single hardcoded
  // `href === "/admin/notifications"` check so Reviews can carry a badge
  // too, without every future badge needing its own special case.
  const badges: Record<string, number> = {
    "/admin/notifications": unreadNotifications,
    "/admin/reviews": pendingReviews,
  };
  const [drawerOpen, setDrawerOpen] = useState(false);
  // F-244 fix: so the mobile nav drawer can return focus here on close —
  // see MobileNavDrawer's `triggerRef`.
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const { confirmLeave } = useUnsavedChangesNav();

  const handleLogout = async () => {
    // F-13: signing out is exactly the kind of navigation a dirty form
    // needs protecting from too — it's not a <Link>, so it isn't covered
    // by GuardedLink's onNavigate check.
    if (!confirmLeave()) return;
    // F-160: close the drawer once the sign-out is actually proceeding (not
    // before confirmLeave, so a cancelled prompt leaves the drawer open) —
    // its cleanup restores document.body's scroll lock, and it keeps the
    // drawer from lingering, half-visible, during the redirect.
    setDrawerOpen(false);
    const res = await fetch("/api/auth/logout", { method: "POST" });
    if (!res.ok) return;
    router.push("/admin/login");
    router.refresh();
  };

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSeeNavItem(user.role, item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-lavender/40 print:bg-white">
      {/* F-244 fix: no way to skip the sidebar nav before this existed —
          a keyboard user tabbed through every nav link on every admin page
          before reaching the page content. Mirrors the storefront's own
          skip link (site-shell.tsx). */}
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-brand focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to content
      </a>
      <div className="mx-auto flex min-h-screen max-w-7xl print:block print:max-w-none">
        {/* F-208 fix: printing an order invoice (which lives inside this
            same admin panel layout — src/app/admin/(panel)/orders/[id]/invoice/page.tsx)
            used to print the whole sidebar and header around it — hamburger,
            "Admin Panel", the signed-in admin's name and "View Storefront" —
            on a lavender page background, above the actual document. */}
        <aside className="hidden w-64 shrink-0 border-r border-border bg-surface p-6 lg:block print:hidden">
          <GuardedLink href="/admin/dashboard" className="font-display text-xl font-extrabold text-brand">
            DAAKYKA Admin
          </GuardedLink>

          {/* F-160: role label moved into AdminAccountFooter below, next to
              Sign Out, so it isn't duplicated once the mobile drawer shows
              the same footer. */}
          <NavLinks groups={visibleGroups} pathname={pathname} badges={badges} />

          <div className="mt-8">
            <AdminAccountFooter role={user.role} onLogout={handleLogout} />
          </div>
        </aside>

        <MobileNavDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          groups={visibleGroups}
          pathname={pathname}
          badges={badges}
          role={user.role}
          onLogout={handleLogout}
          triggerRef={hamburgerRef}
        />

        {/* F-05 (docs/audit-2026-09-19/admin-ux.md): `min-w-0` is required
            here, not decorative. This div is a flex item with no explicit
            width; a flex item's default `min-width: auto` means it refuses
            to shrink below its content's intrinsic (min-content) width —
            and that computation recurses straight through a descendant's
            `overflow-x-auto` (e.g. a `min-w-[900px]` table wrapper several
            levels down in `main`), since only the flex item itself having
            `overflow` set suppresses that. Without `min-w-0` here, a single
            wide table anywhere in `children` silently stretches this whole
            column past the viewport — which is exactly what pushed the
            page header's filters and "New Product" button off-screen at
            390px, confirmed via a live DOM measurement (innerWidth/
            body.scrollWidth reported ~935px until this was added, 390px
            after). `min-w-0` lets this item shrink to the viewport's actual
            width again, so `overflow-x-auto` descendants scroll within
            their own box instead of blowing out the shell. */}
        <div className="min-w-0 flex-1">
          <header className="border-b border-border bg-surface px-4 py-4 lg:px-8 print:hidden">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  ref={hamburgerRef}
                  type="button"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open navigation"
                  aria-expanded={drawerOpen}
                  aria-controls="admin-mobile-nav"
                  className="rounded-lg p-2 text-muted hover:bg-lilac/40 hover:text-ink lg:hidden"
                >
                  <Menu size={22} />
                </button>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand">Admin Panel</p>
                  <p className="font-display text-lg font-bold text-ink">{user.name}</p>
                </div>
              </div>
              <GuardedLink href="/" className="text-sm font-semibold text-brand hover:underline">
                View Storefront
              </GuardedLink>
            </div>
          </header>
          <main id="admin-main" tabIndex={-1} className="p-4 outline-none lg:p-8 print:p-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
