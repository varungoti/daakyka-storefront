import { SectionHeading } from "@/components/ui/section-heading";
import type { Metadata } from "next";
import type { ReactNode } from "react";

interface PolicyPageProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function PolicyPage({ title, description, children }: PolicyPageProps) {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-3xl px-4 lg:px-8">
        <SectionHeading eyebrow="Customer Care" title={title} description={description} align="center" />
        <div className="prose-policy mt-10 space-y-4 text-sm leading-relaxed text-muted">{children}</div>
      </div>
    </section>
  );
}

export function policyMetadata(title: string, description: string): Metadata {
  return { title, description };
}
