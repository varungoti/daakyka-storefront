import { ContactForm } from "@/components/contact/contact-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { brand } from "@/data/brand";
import { Clock, MapPin, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact",
  description: `Contact ${brand.name} — ${brand.legalName}, ${brand.location.city}. Pan India institutional uniforms and medical apparel.`,
};

interface ContactPageProps {
  searchParams: Promise<{ intent?: string; type?: string }>;
}

const typeMap = {
  general: "GENERAL",
  institutional: "INSTITUTIONAL",
  bulk: "BULK_ORDER",
  support: "SUPPORT",
} as const;

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const params = await searchParams;
  const defaultType =
    typeMap[params.type as keyof typeof typeMap] ??
    (params.intent === "checkout" ? "GENERAL" : "GENERAL");

  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <SectionHeading
            eyebrow="Get in Touch"
            title={params.intent === "checkout" ? "Complete Your Order" : "Contact DAAKYKA"}
            description={
              params.intent === "checkout"
                ? "Checkout is being connected. Share your cart details and our team will assist with your order."
                : "Questions about scrubs, hospital linens, school uniforms, or bulk institutional orders? Reach out to Babaji Enterprises."
            }
            align="center"
          />
        </div>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-6">
            <article className="rounded-3xl border border-border bg-lavender/30 p-6">
              <div className="flex items-start gap-3">
                <MapPin className="mt-1 text-brand" size={22} />
                <div>
                  <h2 className="font-display font-bold text-ink">Visit Us</h2>
                  <p className="mt-2 text-sm text-muted">{brand.location.addressLine}</p>
                  <p className="mt-1 text-sm font-medium text-brand">
                    {brand.location.serviceArea} Delivery
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-border bg-white p-6">
              <div className="flex items-start gap-3">
                <Clock className="mt-1 text-brand" size={22} />
                <div>
                  <h2 className="font-display font-bold text-ink">Response Time</h2>
                  <p className="mt-2 text-sm text-muted">
                    We typically respond within 1–2 business days for institutional and bulk
                    enquiries.
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-border bg-white p-6">
              <div className="flex items-start gap-3">
                <MessageCircle className="mt-1 text-trust" size={22} />
                <div>
                  <h2 className="font-display font-bold text-ink">WhatsApp</h2>
                  <p className="mt-2 text-sm text-muted">
                    Prefer messaging? Start a conversation with our team.
                  </p>
                  <Link
                    href={`https://wa.me/?text=${encodeURIComponent(brand.web.whatsappMessage)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex text-sm font-semibold text-trust hover:underline"
                  >
                    Open WhatsApp →
                  </Link>
                </div>
              </div>
            </article>

            <p className="text-xs text-muted">
              Operated by {brand.legalName} ·{" "}
              <a
                href={brand.web.domain}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                daakyka.com
              </a>
            </p>
          </div>

          <ContactForm defaultType={defaultType} />
        </div>
      </div>
    </section>
  );
}
