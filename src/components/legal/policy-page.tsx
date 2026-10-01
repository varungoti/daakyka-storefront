import { SectionHeading } from "@/components/ui/section-heading";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { baseOpenGraph } from "@/lib/seo/json-ld";
import { canonicalPath } from "@/lib/seo/canonical";
import type { Metadata } from "next";
import type { ReactNode } from "react";

interface PolicyPageProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function PolicyPage({ title, description, children }: PolicyPageProps) {
  return (
    <>
      <PageHeroBand innerClassName="max-w-3xl text-center">
        <SectionHeading
          eyebrow="Customer Care"
          title={title}
          description={description}
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection innerClassName="max-w-3xl">
        <div className="prose-policy space-y-4 text-sm leading-relaxed text-muted">{children}</div>
      </PageContentSection>
    </>
  );
}

// release-hardening F-147: this used to return only {title, description},
// so every policy page (terms, returns, shipping, privacy-policy,
// accessibility) inherited the root layout's canonical — which pointed at
// the homepage. `path` is now required so each policy page self-
// canonicalizes instead. F-151: same fix for og:url — see the root
// layout's doc comment for why title/description aren't repeated here.
export function policyMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: canonicalPath(path) },
    openGraph: baseOpenGraph(path),
  };
}
