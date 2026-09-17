import { Button } from "@/components/ui/button";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { verifyEmailToken } from "@/lib/customer-auth/verify-email";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Verify Email",
};

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams;
  const result = token
    ? await verifyEmailToken(token)
    : ({ ok: false, error: "Missing verification token" } as const);

  return (
    <>
      <PageHeroBand innerClassName="max-w-xl text-center">
        <SectionHeading
          eyebrow="Account"
          title={result.ok ? "Email Verified" : "Verification Failed"}
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection className="text-center">
        <p className="mx-auto max-w-md text-sm text-muted">
          {result.ok
            ? "Thanks — your email address is now verified."
            : result.error}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-4">
          <Link href="/account">
            <Button size="lg">Go to My Account</Button>
          </Link>
        </div>
      </PageContentSection>
    </>
  );
}
