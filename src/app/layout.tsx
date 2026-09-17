import type { Metadata } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import { CurrencyProvider } from "@/context/currency-provider";
import { WishlistProvider } from "@/context/wishlist-provider";
import { CartProvider } from "@/context/cart-provider";
import { SiteShell } from "@/components/layout/site-shell";
import { GlobalJsonLd } from "@/components/seo/global-json-ld";
import { isIndexingAllowed } from "@/lib/env";
import { getNavigation } from "@/lib/navigation/get-navigation";
import { getSetting, isPageEnabled } from "@/lib/settings";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  display: "swap",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const allowIndex = isIndexingAllowed();

  return {
    title: {
      default: "DAAKYKA Apparels | Quality Uniforms & Linens for Pan India",
      template: "%s | DAAKYKA Apparels",
    },
    description:
      "Expertly designed, meticulously crafted. Hospital linens, medical scrubs, school uniforms, and corporate wear by Babaji Enterprises — Hyderabad, Pan India delivery.",
    robots: allowIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [
    fabricTechEnabled,
    mixMatchEnabled,
    announcementMessages,
    contactPhone,
    contactWhatsapp,
    bulkCtaEnabled,
    navigation,
  ] = await Promise.all([
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
    getSetting("announcement.messages"),
    getSetting("contact.phone"),
    getSetting("contact.whatsapp"),
    getSetting("header.bulkCta.enabled"),
    getNavigation(),
  ]);

  return (
    <html lang="en" className={`${outfit.variable} ${dmSans.variable} h-full`}>
      <head>
        <link rel="preconnect" href="https://images.pexels.com" />
        <link rel="preconnect" href="https://daakyka.com" />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <GlobalJsonLd />
        <CurrencyProvider>
          <WishlistProvider>
            <CartProvider>
              <SiteShell
                fabricTechEnabled={fabricTechEnabled}
                mixMatchEnabled={mixMatchEnabled}
                announcementMessages={announcementMessages}
                contactPhone={contactPhone}
                contactWhatsapp={contactWhatsapp}
                bulkCtaEnabled={bulkCtaEnabled}
                navigation={navigation}
              >
                {children}
              </SiteShell>
            </CartProvider>
          </WishlistProvider>
        </CurrencyProvider>
      </body>
    </html>
  );
}
