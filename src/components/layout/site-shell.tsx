"use client";

import { UtilityBar } from "@/components/layout/announcement-bar";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { WhatsAppFab } from "@/components/layout/whatsapp-fab";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { CartAbandonTracker } from "@/components/cart/cart-abandon-tracker";
import { WishlistDrawer } from "@/components/wishlist/wishlist-drawer";
import type { NavigationTree } from "@/lib/navigation/get-navigation";
import { usePathname } from "next/navigation";

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
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-xl focus:bg-brand focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>
      <UtilityBar
        messages={announcementMessages}
        phone={contactPhone}
        whatsapp={contactWhatsapp}
        bulkCtaEnabled={bulkCtaEnabled}
      />
      <Header navigation={navigation} />
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer
        fabricTechEnabled={fabricTechEnabled}
        mixMatchEnabled={mixMatchEnabled}
        saleEnabled={saleEnabled}
        contactPhone={contactPhone}
        contactWhatsapp={contactWhatsapp}
        contactEmail={contactEmail}
        contactAddress={contactAddress}
      />
      <WhatsAppFab />
      <CartDrawer />
      <CartAbandonTracker />
      <WishlistDrawer />
    </>
  );
}
