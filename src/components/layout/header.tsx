"use client";

import { useCart } from "@/context/cart-provider";
import { useWishlist } from "@/context/wishlist-provider";
import { SearchDialog } from "@/components/search/search-dialog";
import { CurrencyToggle } from "@/components/layout/currency-toggle";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { NavItem, NavigationTree } from "@/lib/navigation/get-navigation";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  Heart,
  Menu,
  Search,
  ShoppingBag,
  User,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// See site-shell.tsx's comment on CartDrawer/WishlistDrawer: next/dynamic
// here measured worse (higher LCP, no unused-JS improvement, since
// SearchDialog is unconditionally rendered too), so this stays a static
// import.

export function Header({ navigation }: { navigation: NavigationTree }) {
  const pathname = usePathname();
  const { cart, openCart } = useCart();
  const { count: wishlistCount, openWishlist } = useWishlist();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 border-b transition-all duration-300",
          scrolled
            ? "border-border bg-background/95 backdrop-blur-xl shadow-[0_4px_24px_var(--shadow-tint)]"
            : "border-transparent bg-background/80 backdrop-blur-md",
        )}
      >
        <div className="mx-auto grid max-w-[1320px] grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-4 lg:px-8">
          <div className="flex items-center gap-1">
            <IconButton label="Search" onClick={() => setSearchOpen(true)}>
              <Search size={18} />
            </IconButton>
          </div>

          <Link
            href="/"
            className="justify-self-center font-display text-lg font-bold tracking-tight text-ink md:text-xl"
          >
            DAAKYKA
            <span className="ml-1 font-semibold text-brand">APPARELS</span>
          </Link>

          <div className="flex items-center justify-end gap-1 md:gap-2">
            <IconButton label="Account" className="hidden sm:flex" href="/account">
              <User size={18} />
            </IconButton>
            <IconButton
              label="Wishlist"
              badge={wishlistCount > 0 ? wishlistCount : undefined}
              onClick={openWishlist}
              className="hidden sm:flex"
            >
              <Heart size={18} />
            </IconButton>
            <IconButton
              label="Cart"
              badge={cart.totalQuantity > 0 ? cart.totalQuantity : undefined}
              onClick={openCart}
            >
              <ShoppingBag size={18} />
            </IconButton>
            <div className="hidden md:block">
              <CurrencyToggle />
            </div>
            <button
              ref={mobileTriggerRef}
              type="button"
              className="rounded-full p-2.5 text-ink lg:hidden"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        <DesktopNav items={navigation.items} pathname={pathname} />
      </header>

      <MobileNavDrawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        items={navigation.items}
        pathname={pathname}
        triggerRef={mobileTriggerRef}
      />

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}

function IconButton({
  children,
  label,
  badge,
  onClick,
  className,
  href,
}: {
  children: React.ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
  className?: string;
  href?: string;
}) {
  const classes = cn(
    "relative rounded-full p-2.5 text-ink transition hover:bg-lilac/60 hover:text-brand",
    className,
  );
  const content = (
    <>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-label={label} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" aria-label={label} onClick={onClick} className={classes}>
      {content}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Desktop nav (centered horizontal menu with mega-menu dropdowns)
// ---------------------------------------------------------------------------

function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DesktopNav({ items, pathname }: { items: NavItem[]; pathname: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openMenu = (id: string) => {
    clearCloseTimer();
    setOpenId(id);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpenId(null), 150);
  };

  const closeNow = (returnFocusTo?: string) => {
    clearCloseTimer();
    setOpenId(null);
    if (returnFocusTo) triggerRefs.current.get(returnFocusTo)?.focus();
  };

  // Escape closes the open menu and returns focus to its trigger.
  useEffect(() => {
    if (!openId) return;
    const currentId = openId;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeNow(currentId);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  // Click outside the nav closes any open menu.
  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenId(null);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openId]);

  const openItem = items.find((item) => item.id === openId && item.kind !== "link");

  return (
    <div
      ref={navRef}
      className="relative hidden border-t border-border/70 lg:block"
      onMouseLeave={scheduleClose}
    >
      <nav className="mx-auto flex max-w-[1320px] items-center justify-center gap-1 px-4 lg:px-8">
        {items.map((item) => {
          const active = isNavItemActive(pathname, item.href);
          const isOpen = openId === item.id;

          if (item.kind === "link") {
            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  "px-4 py-3 text-xs font-bold uppercase tracking-[0.15em] transition-colors hover:text-brand",
                  active ? "text-brand" : "text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          }

          return (
            <div key={item.id} onMouseEnter={() => openMenu(item.id)}>
              <button
                type="button"
                ref={(el) => {
                  if (el) triggerRefs.current.set(item.id, el);
                  else triggerRefs.current.delete(item.id);
                }}
                aria-haspopup="true"
                aria-expanded={isOpen}
                aria-controls={`nav-panel-${item.id}`}
                onClick={() => (isOpen ? closeNow(item.id) : openMenu(item.id))}
                className={cn(
                  "flex items-center gap-1 px-4 py-3 text-xs font-bold uppercase tracking-[0.15em] transition-colors hover:text-brand",
                  active || isOpen ? "text-brand" : "text-ink",
                )}
              >
                {item.label}
                <ChevronDown
                  size={13}
                  className={cn("transition-transform", isOpen && "rotate-180")}
                />
              </button>
            </div>
          );
        })}
      </nav>

      {/* A single shared panel centered under the whole nav bar (not
          per-trigger), so it never clips off-screen for items near the
          left/right edge — the common "mega menu bar" pattern. */}
      {openItem && openItem.kind !== "link" && (
        <div
          id={`nav-panel-${openItem.id}`}
          role="region"
          aria-label={`${openItem.label} menu`}
          className="absolute inset-x-0 top-full z-50 flex justify-center px-4"
        >
          <div className="w-max max-w-[min(94vw,880px)] rounded-2xl border border-border bg-background p-6 shadow-[0_16px_40px_var(--shadow-tint)]">
            <NavPanel item={openItem} onNavigate={() => closeNow()} />
          </div>
        </div>
      )}
    </div>
  );
}

function NavPanel({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  if (item.kind === "mega-grid") {
    return (
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4">
        {item.tiles.map((tile) => (
          <div key={tile.href} className="w-40">
            <Link
              href={tile.href}
              onClick={onNavigate}
              className="group block overflow-hidden rounded-xl border border-border bg-alt-surface"
            >
              <div className="relative aspect-[4/3] bg-lilac/40">
                {tile.image ? (
                  <Image
                    src={tile.image.url}
                    alt={tile.image.alt}
                    fill
                    loading="eager"
                    className="object-cover transition duration-300 group-hover:scale-105"
                    sizes="200px"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {tile.label}
                  </div>
                )}
              </div>
            </Link>
            <Link
              href={tile.href}
              onClick={onNavigate}
              className="mt-2 block text-sm font-bold text-ink hover:text-brand"
            >
              {tile.label}
            </Link>
            {tile.children.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {tile.children.slice(0, 4).map((child) => (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      onClick={onNavigate}
                      className="block text-xs text-muted hover:text-brand"
                    >
                      {child.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (item.kind === "mega-columns") {
    return (
      <div className="flex gap-10">
        {item.columns.map((column) => (
          <div key={column.heading} className="min-w-[160px]">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-brand-violet">
              {column.heading}
            </p>
            <ul className="mt-3 space-y-2">
              {column.items.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onNavigate}
                    className="text-sm text-ink hover:text-brand"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              {column.items.length === 0 && (
                <li className="text-sm text-muted">Coming soon</li>
              )}
            </ul>
          </div>
        ))}
        {item.promo && (
          <Link
            href={item.promo.href}
            onClick={onNavigate}
            className="flex min-w-[180px] flex-col justify-center rounded-xl bg-brand-violet px-5 py-6 text-sm font-bold text-white transition hover:opacity-90"
          >
            {item.promo.label}
          </Link>
        )}
      </div>
    );
  }

  if (item.kind === "simple") {
    return (
      <ul className="min-w-[200px] space-y-2">
        {item.children.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              onClick={onNavigate}
              className="block text-sm text-ink hover:text-brand"
            >
              {link.label}
            </Link>
          </li>
        ))}
        {item.children.length === 0 && (
          <li className="text-sm text-muted">Coming soon</li>
        )}
      </ul>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mobile nav drawer (full-height accordion)
// ---------------------------------------------------------------------------

function MobileNavDrawer({
  open,
  onClose,
  items,
  pathname,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  pathname: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const panelRef = useFocusTrap<HTMLDivElement>(open, onClose, { restoreFocusRef: triggerRef });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Site navigation">
      <button
        type="button"
        className="absolute inset-0 bg-overlay-scrim backdrop-blur-sm"
        aria-label="Close menu"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex h-full w-full max-w-sm flex-col overflow-y-auto bg-background shadow-2xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <p className="font-display font-bold text-ink">Menu</p>
          <button type="button" onClick={onClose} aria-label="Close menu" className="rounded-full p-2 text-ink hover:bg-lilac/50">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-4">
          {items.map((item) => {
            const active = isNavItemActive(pathname, item.href);

            if (item.kind === "link") {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "block rounded-xl px-4 py-3 text-sm font-semibold transition",
                    active ? "bg-brand/10 text-brand" : "text-ink hover:bg-lilac/40",
                  )}
                >
                  {item.label}
                </Link>
              );
            }

            const expanded = expandedId === item.id;
            const childLinks: { label: string; href: string }[] =
              item.kind === "simple"
                ? item.children
                : item.kind === "mega-grid"
                  ? item.tiles.map((tile) => ({ label: tile.label, href: tile.href }))
                  : item.columns.flatMap((column) => column.items);

            return (
              <div key={item.id} className="rounded-xl">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                  aria-expanded={expanded}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-semibold transition",
                    active ? "bg-brand/10 text-brand" : "text-ink hover:bg-lilac/40",
                  )}
                >
                  {item.label}
                  <ChevronDown size={16} className={cn("transition-transform", expanded && "rotate-180")} />
                </button>
                {expanded && (
                  <div className="space-y-1 py-2 pl-6">
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className="block rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-lilac/30"
                    >
                      View all {item.label}
                    </Link>
                    {childLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={onClose}
                        className="block rounded-lg px-3 py-2 text-sm text-muted hover:bg-lilac/30 hover:text-ink"
                      >
                        {link.label}
                      </Link>
                    ))}
                    {item.kind === "mega-columns" && item.promo && (
                      <Link
                        href={item.promo.href}
                        onClick={onClose}
                        className="mt-1 block rounded-lg bg-brand-violet px-3 py-2 text-sm font-bold text-white"
                      >
                        {item.promo.label}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="space-y-3 border-t border-border p-4">
          <CurrencyToggle />
          <div className="flex gap-2">
            <Link
              href="/account"
              onClick={onClose}
              className="flex-1 rounded-xl border border-border px-4 py-2.5 text-center text-sm font-semibold text-ink hover:border-brand hover:text-brand"
            >
              Account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
