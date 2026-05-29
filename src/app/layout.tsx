import type { Metadata } from "next";
import { DM_Sans, Outfit } from "next/font/google";
import { ThemeProvider } from "@/context/theme-provider";
import { CurrencyProvider } from "@/context/currency-provider";
import { WishlistProvider } from "@/context/wishlist-provider";
import { CartProvider } from "@/context/cart-provider";
import { SiteShell } from "@/components/layout/site-shell";
import { GlobalJsonLd } from "@/components/seo/global-json-ld";
import { isIndexingAllowed } from "@/lib/env";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="light" className={`${outfit.variable} ${dmSans.variable} h-full`} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://images.pexels.com" />
        <link rel="preconnect" href="https://daakyka.com" />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        <GlobalJsonLd />
        <ThemeProvider>
          <CurrencyProvider>
            <WishlistProvider>
              <CartProvider>
                <SiteShell>{children}</SiteShell>
              </CartProvider>
            </WishlistProvider>
          </CurrencyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
