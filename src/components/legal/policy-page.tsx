import { SectionHeading } from "@/components/ui/section-heading";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
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
        <SectionHeading eyebrow="Customer Care" title={title} description={description} align="center" />
      </PageHeroBand>
      <PageContentSection innerClassName="max-w-3xl">
        <div className="prose-policy space-y-4 text-sm leading-relaxed text-muted">{children}</div>
      </PageContentSection>
    </>
  );
}

export function policyMetadata(title: string, description: string): Metadata {
  return { title, description };
}
