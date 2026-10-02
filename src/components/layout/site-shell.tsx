"use client";

import { UtilityBar } from "@/components/layout/announcement-bar";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { WhatsAppFab } from "@/components/layout/whatsapp-fab";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { CartAbandonTracker } from "@/components/cart/cart-abandon-tracker";
import { LazyMotionProvider } from "@/components/layout/lazy-motion-provider";
import { WishlistDrawer } from "@/components/wishlist/wishlist-drawer";
import type { NavigationTree } from "@/lib/navigation/get-navigation";
import { MotionConfig } from "framer-motion";
import { usePathname } from "next/navigation";

// release-hardening perf pass — tried next/dynamic(ssr:false) here for
// CartDrawer/WishlistDrawer to keep their framer-motion dependency out of
// the main bundle. Measured result (see docs/PERFORMANCE.md): the
// framer-motion chunk's unused-bytes count on Lighthouse's
// unused-javascript audit was *identical* before and after (both drawers
// are unconditionally rendered — controlled via internal open state, not
// conditional mounting — so next/dynamic doesn't defer the fetch, it just
// relocates it), while median LCP got measurably worse across all three
// audited URLs, most likely from the added Suspense/lazy coordination
// overhead on the critical hydration path. Reverted back to static
// imports as a net loss. A real fix would need to defer *mounting* until
// first interaction, not just switch the import mechanism — left as a
// follow-up since it touches focus-trap/open-state timing this pass
// didn't have the test coverage to verify safely.
//
// F-258: the follow-up that does work is shrinking what is shipped up front
// rather than when it is fetched. The drawers and dialogs use the `m.*`
// elements inside LazyMotionProvider below, so the page's main JS carries only
// the small motion core (AnimatePresence, MotionConfig, `m`); the animation
// features are a separate chunk loaded after hydration.

export function SiteShell({
  children,
  fabricTechEnabled,
  mixMatchEnabled,
  saleEnabled,
  announcementMessages,
  contactPhone,
  contactWhatsapp,
  contactEmail,
  contactAddress,
  bulkCtaEnabled,
  navigation,
}: {
  children: React.ReactNode;
  fabricTechEnabled: boolean;
  mixMatchEnabled: boolean;
  saleEnabled: boolean;
  announcementMessages: string[];
  contactPhone: string;
  contactWhatsapp: string;
  contactEmail: string;
  contactAddress: string;
  bulkCtaEnabled: boolean;
  navigation: NavigationTree;
}) {
  const pathname = usePathname();

  if (pathname?.startsWith("/admin")) {
    return <>{children}</>;
  }

  return (
    // F-245: the cart, wishlist, filter and search drawers/dialogs are
    // framer-motion springs, which the CSS `prefers-reduced-motion` rule in
    // globals.css can't reach. `reducedMotion="user"` makes every motion
    // component below (this wraps the page `children` too, so the shop's
    // filter drawer is covered) skip transform animations — the drawers
    // appear without sliding — whenever the visitor's OS asks for less
    // motion. No new JS: MotionConfig is just framer-motion's context
    // provider (LazyMotionProvider, F-258, sits inside it).
    <MotionConfig reducedMotion="user">
      <LazyMotionProvider>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-brand focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to main content
        </a>
        {/* F-328: none of this site chrome belongs on a printed page (e.g. an
            order receipt, src/app/order/[number]/page.tsx) — a wrapping
            print:hidden div per component, rather than one div around all
            six, so each stays a plain sibling and this can't change any of
            their existing on-screen layout. globals.css carries a
            structural (tag/role-based) @media print fallback for the same
            elements as defense-in-depth. */}
        {/* aside, not div, so the announcement strip and the floating
            WhatsApp button below sit inside a landmark (axe "region"). */}
        <aside aria-label="Announcements" className="print:hidden">
          <UtilityBar
            messages={announcementMessages}
            phone={contactPhone}
            whatsapp={contactWhatsapp}
            bulkCtaEnabled={bulkCtaEnabled}
          />
        </aside>
        <div className="print:hidden">
          <Header navigation={navigation} />
        </div>
        <main id="main-content" className="flex-1">
          {children}
        </main>
        <div className="print:hidden">
          <Footer
            fabricTechEnabled={fabricTechEnabled}
            mixMatchEnabled={mixMatchEnabled}
            saleEnabled={saleEnabled}
            contactPhone={contactPhone}
            contactWhatsapp={contactWhatsapp}
            contactEmail={contactEmail}
            contactAddress={contactAddress}
          />
        </div>
        <aside aria-label="WhatsApp" className="print:hidden">
          <WhatsAppFab whatsapp={contactWhatsapp} />
        </aside>
        <div className="print:hidden">
          <CartDrawer />
        </div>
        <CartAbandonTracker />
        <div className="print:hidden">
          <WishlistDrawer />
        </div>
      </LazyMotionProvider>
    </MotionConfig>
  );
}
