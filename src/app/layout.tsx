import type { Metadata, Viewport } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import { CurrencyProvider } from "@/context/currency-provider";
import { WishlistProvider } from "@/context/wishlist-provider";
import { CartProvider } from "@/context/cart-provider";
import { SiteShell } from "@/components/layout/site-shell";
import { GlobalJsonLd } from "@/components/seo/global-json-ld";
import { isIndexingAllowed } from "@/lib/env";
import { getNavigation } from "@/lib/navigation/get-navigation";
import { siteVerification } from "@/lib/seo/verification";
import { getSetting, isPageEnabled, isSaleEnabled } from "@/lib/settings";
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

const SITE_DESCRIPTION =
  "Expertly designed, meticulously crafted. Hospital linens, medical scrubs, school uniforms, and corporate wear by Babaji Enterprises — Hyderabad, Pan India delivery.";

// F-089: the mobile browser chrome's brand colour — matches manifest.ts's
// theme_color so the two never drift apart.
export const viewport: Viewport = {
  themeColor: "#8A347D",
};

export async function generateMetadata(): Promise<Metadata> {
  const allowIndex = isIndexingAllowed();

  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://daakyka.com"),
    title: {
      default: "DAAKYKA Apparels | Quality Uniforms & Linens for Pan India",
      template: "%s | DAAKYKA Apparels",
    },
    description: SITE_DESCRIPTION,
    // release-hardening F-147: this used to be `canonical: canonicalPath("/")`
    // here, and Next merges metadata per-key across segments — so any page
    // that didn't set its own `alternates` (most of the legal/contact/
    // collections pages didn't) silently inherited the *homepage's*
    // canonical instead of having none. A missing canonical is harmless; a
    // wrong one tells search engines the page is a duplicate of "/". The
    // homepage now sets its own canonical (src/app/page.tsx).
    //
    // F-151: same reasoning for `openGraph.title`/`description` and
    // `twitter.title`/`description` below — they used to be hardcoded here
    // too, which every page without its own `openGraph`/`twitter` (i.e.
    // almost all of them) inherited verbatim, so sharing any blog post,
    // guide or policy page on WhatsApp/LinkedIn/X showed the homepage's
    // card. Next's own metadata resolution (postProcessMetadata in
    // node_modules/next/dist/lib/metadata/resolve-metadata.js) already
    // fills an empty openGraph/twitter title+description from the page's
    // own resolved <title>/description — so simply not setting them here
    // lets every page get its own social title for free, and the homepage
    // (src/app/page.tsx) still gets these exact strings via its own
    // title/description.
    openGraph: {
      type: "website",
      siteName: "DAAKYKA Apparels",
      locale: "en_IN",
    },
    twitter: {
      card: "summary_large_image",
    },
    robots: allowIndex
      ? { index: true, follow: true }
      : { index: false, follow: false },
    // F-320: no-ops (Next omits the tag) until the owner sets
    // GOOGLE_SITE_VERIFICATION / FB_DOMAIN_VERIFICATION from Search Console /
    // Meta Business Suite — see src/lib/seo/verification.ts.
    verification: siteVerification(),
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
    saleEnabled,
    announcementMessages,
    contactPhone,
    contactWhatsapp,
    contactEmail,
    contactAddress,
    bulkCtaEnabled,
    navigation,
    freeShippingThresholdInr,
  ] = await Promise.all([
    isPageEnabled("fabricTech"),
    isPageEnabled("mixMatch"),
    isSaleEnabled(),
    getSetting("announcement.messages"),
    getSetting("contact.phone"),
    getSetting("contact.whatsapp"),
    getSetting("contact.email"),
    getSetting("contact.address"),
    getSetting("header.bulkCta.enabled"),
    getNavigation(),
    // F-008: the single source of truth for the trust bar's free-shipping
    // threshold — see CurrencyProvider's doc comment on this prop.
    getSetting("shipping.freeAbove"),
  ]);

  return (
    <html lang="en" className={`${outfit.variable} ${dmSans.variable} h-full`}>
      <head>
        <link rel="preconnect" href="https://images.pexels.com" />
        {/* No preconnect to daakyka.com: that domain is currently
            unreachable (see the doc comment atop src/data/media/catalog.ts)
            and no rendered component hotlinks it any more, so this would
            only cost every visitor a wasted DNS/TCP attempt. */}
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <GlobalJsonLd contactAddress={contactAddress} contactPhone={contactPhone} contactEmail={contactEmail} />
        <CurrencyProvider freeShippingThresholdInr={freeShippingThresholdInr}>
          <WishlistProvider>
            <CartProvider>
              <SiteShell
                fabricTechEnabled={fabricTechEnabled}
                mixMatchEnabled={mixMatchEnabled}
                saleEnabled={saleEnabled}
                announcementMessages={announcementMessages}
                contactPhone={contactPhone}
                contactWhatsapp={contactWhatsapp}
                contactEmail={contactEmail}
                contactAddress={contactAddress}
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
