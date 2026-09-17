import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { ResetPasswordForm } from "@/components/account/reset-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password",
  description: "Choose a new password for your DAAKYKA Apparels account.",
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token } = await searchParams;

  return (
    <>
      <PageHeroBand innerClassName="max-w-xl text-center">
        <SectionHeading eyebrow="Account" title="Reset Password" align="center" titleAs="h1" />
      </PageHeroBand>
      <PageContentSection innerClassName="max-w-md">
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="text-center text-sm text-red-600">
            This link is missing a token. Please use the link from your email.
          </p>
        )}
      </PageContentSection>
    </>
  );
}
