import { Button } from "@/components/ui/button";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account",
  description: "Sign in to your DAAKYKA Apparels account to track orders, wishlists, and reviews.",
};

/**
 * Phase C2 stub: the header's account icon needs somewhere to link to
 * that doesn't 404. Full customer accounts (register/login/orders/
 * addresses/reviews) are Phase D1 — not built yet.
 */
export default function AccountPage() {
  return (
    <>
      <PageHeroBand innerClassName="max-w-2xl text-center">
        <SectionHeading
          eyebrow="Account"
          title="Customer Accounts Are Coming Soon"
          description="Order tracking, saved addresses, wishlists, and reviews will live here shortly. Until then, checkout works as a guest and our team is happy to help with anything else."
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection className="text-center">
        <div className="flex flex-wrap justify-center gap-4">
          <Link href="/shop">
            <Button size="lg">Continue Shopping</Button>
          </Link>
          <Link href="/contact">
            <Button variant="outline" size="lg">
              Contact Support
            </Button>
          </Link>
        </div>
      </PageContentSection>
    </>
  );
}
