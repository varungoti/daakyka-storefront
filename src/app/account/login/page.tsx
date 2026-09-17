import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { LoginForm } from "@/components/account/login-form";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { sanitizeReturnTo } from "@/lib/customer-auth/return-to";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your DAAKYKA Apparels account.",
};

interface LoginPageProps {
  searchParams: Promise<{ returnTo?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getCustomerSession();
  const { returnTo } = await searchParams;
  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (session) {
    redirect(safeReturnTo);
  }

  return (
    <>
      <PageHeroBand innerClassName="max-w-xl text-center">
        <SectionHeading eyebrow="Account" title="Sign In" align="center" titleAs="h1" />
      </PageHeroBand>
      <PageContentSection innerClassName="max-w-md">
        <LoginForm returnTo={safeReturnTo} />
      </PageContentSection>
    </>
  );
}
