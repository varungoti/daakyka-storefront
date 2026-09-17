import { Button } from "@/components/ui/button";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Newsletter Confirmed",
};

interface NewsletterConfirmedPageProps {
  searchParams: Promise<{ status?: string }>;
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
          <Link href="/">
            <Button size="lg">Back to Home</Button>
          </Link>
        </div>
      </PageContentSection>
    </>
  );
}
