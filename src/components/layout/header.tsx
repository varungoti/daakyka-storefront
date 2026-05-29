"use client";

import { useCart } from "@/context/cart-provider";
import { useWishlist } from "@/context/wishlist-provider";
import { useTheme } from "@/context/theme-provider";
import { SearchDialog } from "@/components/search/search-dialog";
import { CurrencyToggle } from "@/components/layout/currency-toggle";
import { mainNav } from "@/data/navigation";
import { cn } from "@/lib/utils";
import {
  Heart,
  Menu,
  Moon,
  Search,
  ShoppingBag,
  Sun,
  User,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function Header() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { cart, openCart } = useCart();
  const { count: wishlistCount, openWishlist } = useWishlist();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-50 border-b transition-all duration-300",
          scrolled
            ? "border-border bg-background/95 backdrop-blur-xl shadow-[0_4px_24px_rgba(91,46,255,0.06)]"
            : "border-transparent bg-background/80 backdrop-blur-md",
        )}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 lg:px-8">
          <Link
            href="/"
            className="font-display text-lg font-extrabold tracking-tight text-ink md:text-xl"
          >
            DAAKYKA
            <span className="ml-1 font-semibold text-brand">APPARELS</span>
          </Link>

          <nav className="hidden items-center gap-8 lg:flex">
            {mainNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "text-xs font-bold uppercase tracking-[0.15em] transition-colors hover:text-brand",
                  pathname === item.href || pathname.startsWith(`${item.href}/`)
                    ? "text-brand"
                    : "text-ink",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1 md:gap-2">
            <IconButton label="Search" onClick={() => setSearchOpen(true)}>
              <Search size={18} />
            </IconButton>
            <IconButton label="Account" className="hidden sm:flex">
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
              type="button"
              onClick={toggleTheme}
              className="hidden items-center gap-2 rounded-full border border-border bg-white/70 px-3 py-2 text-xs font-semibold text-ink transition hover:border-brand lg:flex"
              aria-label="Toggle theme"
            >
              {theme === "light" ? <Sun size={14} /> : <Moon size={14} />}
              {theme === "light" ? "Light" : "Dark"}
            </button>
            <button
              type="button"
              className="rounded-full p-2.5 text-ink lg:hidden"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute right-0 top-0 flex h-full w-[min(100%,320px)] flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <p className="font-display font-bold text-ink">Menu</p>
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close">
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-4">
              {mainNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "block rounded-xl px-4 py-3 text-sm font-semibold transition",
                    pathname === item.href
                      ? "bg-brand/10 text-brand"
                      : "text-ink hover:bg-lavender/60",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="space-y-3 border-t border-border p-4">
              <CurrencyToggle />
              <button
                type="button"
                onClick={toggleTheme}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-semibold"
              >
                {theme === "light" ? <Sun size={16} /> : <Moon size={16} />}
                {theme === "light" ? "Light Mode" : "Dark Mode"}
              </button>
            </div>
          </div>
        </div>
      )}

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
}: {
  children: React.ReactNode;
  label: string;
  badge?: number;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative rounded-full p-2.5 text-ink transition hover:bg-lilac/60 hover:text-brand",
        className,
      )}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
