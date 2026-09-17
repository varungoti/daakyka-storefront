import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { ForgotPasswordForm } from "@/components/account/forgot-password-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Forgot Password",
  description: "Reset the password for your DAAKYKA Apparels account.",
};

export default function ForgotPasswordPage() {
  return (
    <>
      <PageHeroBand innerClassName="max-w-xl text-center">
        <SectionHeading
          eyebrow="Account"
          title="Forgot Your Password?"
          description="Enter your email and we'll send you a link to reset it."
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection innerClassName="max-w-md">
        <ForgotPasswordForm />
      </PageContentSection>
    </>
  );
}
