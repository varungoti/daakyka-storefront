import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { RegisterForm } from "@/components/account/register-form";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { sanitizeReturnTo } from "@/lib/customer-auth/return-to";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Create a DAAKYKA Apparels account to track orders, save addresses, and write reviews.",
};

interface RegisterPageProps {
  searchParams: Promise<{ returnTo?: string }>;
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const session = await getCustomerSession();
  const { returnTo } = await searchParams;
  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (session) {
    redirect(safeReturnTo);
  }

  return (
    <>
      <PageHeroBand innerClassName="max-w-xl text-center">
        <SectionHeading
          eyebrow="Account"
          title="Create Your Account"
          description="Track orders, save addresses, and write reviews on products you've bought."
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection innerClassName="max-w-md">
        <RegisterForm returnTo={safeReturnTo} />
      </PageContentSection>
    </>
  );
}
