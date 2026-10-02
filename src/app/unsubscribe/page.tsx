import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { UnsubscribeForm } from "@/components/engagement/unsubscribe-form";
import { getSetting } from "@/lib/settings";
import type { Metadata } from "next";

// release-hardening F-147/F-045: this used to inherit the layout's
// `index, follow` (and, before F-147, the homepage's canonical) even though
// it only ever makes sense with a recipient's own `?token=` link — noindex
// keeps the bare URL out of search results.
export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
};

interface UnsubscribePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const [{ token }, contactEmail] = await Promise.all([searchParams, getSetting("contact.email")]);

  return (
    <>
      <PageHeroBand innerClassName="max-w-xl text-center">
        <SectionHeading eyebrow="Newsletter" title="Unsubscribe" align="center" titleAs="h1" />
      </PageHeroBand>
      <PageContentSection className="text-center">
        <UnsubscribeForm token={token ?? ""} contactEmail={contactEmail} />
      </PageContentSection>
    </>
  );
}
