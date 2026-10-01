import { buttonClassNames } from "@/components/ui/button";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import type { Metadata } from "next";
import Link from "next/link";

interface NewsletterConfirmedPageProps {
  searchParams: Promise<{ status?: string }>;
}

// release-hardening F-147/F-045: a one-off landing page for the confirmation
// email's link — noindex, and the title says "Confirmation Failed" when the
// <h1> does (it used to say "Newsletter Confirmed" for every status, which
// is also what the bare, status-less URL showed above a "Confirmation
// Failed" heading).
export async function generateMetadata({
  searchParams,
}: NewsletterConfirmedPageProps): Promise<Metadata> {
  const { status } = await searchParams;
  return {
    title: status === "ok" ? "Subscription Confirmed" : "Confirmation Failed",
    robots: { index: false, follow: false },
  };
}

export default async function NewsletterConfirmedPage({
  searchParams,
}: NewsletterConfirmedPageProps) {
  const { status } = await searchParams;
  const ok = status === "ok";

  return (
    <>
      <PageHeroBand innerClassName="max-w-xl text-center">
        <SectionHeading
          eyebrow="Newsletter"
          title={ok ? "Subscription Confirmed" : "Confirmation Failed"}
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection className="text-center">
        <p className="mx-auto max-w-md text-sm text-muted">
          {ok
            ? "Thanks — you're all set. Look out for our next update in your inbox."
            : "That confirmation link is invalid or has already been used."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-4">
          <Link href="/" className={buttonClassNames({ size: "lg" })}>
            Back to Home
          </Link>
        </div>
      </PageContentSection>
    </>
  );
}
