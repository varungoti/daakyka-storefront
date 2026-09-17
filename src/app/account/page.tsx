import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { AccountTabs } from "@/components/account/account-tabs";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "My Account",
  description: "Manage your DAAKYKA Apparels orders, addresses, reviews, and profile.",
};

export default async function AccountPage() {
  const session = await getCustomerSession();
  if (!session) {
    redirect("/account/login?returnTo=/account");
  }

  const [customer, addresses, reviews] = await Promise.all([
    db.customer.findUnique({
      where: { id: session.id },
      select: { id: true, email: true, name: true, phone: true, emailVerifiedAt: true },
    }),
    db.customerAddress.findMany({
      where: { customerId: session.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    db.review.findMany({
      where: { customerId: session.id },
      orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true, slug: true } } },
    }),
  ]);

  if (!customer) {
    redirect("/account/login?returnTo=/account");
  }

  return (
    <>
      <PageHeroBand innerClassName="max-w-2xl text-center">
        <SectionHeading
          eyebrow="Account"
          title={`Welcome back, ${customer.name.split(" ")[0]}`}
          description="Manage your orders, addresses, reviews, and profile."
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection>
        <AccountTabs
          customer={{
            id: customer.id,
            email: customer.email,
            name: customer.name,
            phone: customer.phone,
            emailVerified: Boolean(customer.emailVerifiedAt),
          }}
          initialAddresses={addresses.map((address) => ({
            id: address.id,
            label: address.label,
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            state: address.state,
            postalCode: address.postalCode,
            country: address.country,
            phone: address.phone,
            isDefault: address.isDefault,
          }))}
          initialReviews={reviews.map((review) => ({
            id: review.id,
            rating: review.rating,
            title: review.title,
            body: review.body,
            status: review.status,
            createdAt: review.createdAt.toISOString(),
            productName: review.product.name,
            productSlug: review.product.slug,
          }))}
        />
      </PageContentSection>
    </>
  );
}
