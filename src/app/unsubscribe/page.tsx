import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { UnsubscribeForm } from "@/components/engagement/unsubscribe-form";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Unsubscribe",
};

interface UnsubscribePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { token } = await searchParams;

  return (
    <>
      <PageHeroBand innerClassName="max-w-xl text-center">
        <SectionHeading eyebrow="Newsletter" title="Unsubscribe" align="center" titleAs="h1" />
      </PageHeroBand>
      <PageContentSection className="text-center">
        <UnsubscribeForm token={token ?? ""} />
      </PageContentSection>
    </>
  );
}
