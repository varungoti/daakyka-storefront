import { ResendVerificationButton } from "@/components/account/resend-verification-button";
import { buttonClassNames } from "@/components/ui/button";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { getCustomerSession } from "@/lib/customer-auth/session";
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

  // F3 fix: a link here (expired/invalid/missing token) previously had no
  // in-app recovery — offer a resend when we know who's asking (an
  // unverified customer still has a session even after their token
  // expired, since sessions and VERIFY tokens have independent
  // lifetimes), or point a logged-out visitor at login instead of a dead
  // end.
  const session = result.ok ? null : await getCustomerSession();

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
        {!result.ok && session && !session.emailVerifiedAt && (
          <div className="mt-4 flex justify-center">
            <ResendVerificationButton email={session.email} />
          </div>
        )}
        {!result.ok && !session && (
          <p className="mt-4 text-sm text-muted">
            <Link href="/account/login?returnTo=/account" className="font-semibold text-brand hover:underline">
              Log in
            </Link>{" "}
            to resend a verification link.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-4">
          <Link href="/account" className={buttonClassNames({ size: "lg" })}>
            Go to My Account
          </Link>
        </div>
      </PageContentSection>
    </>
  );
}
