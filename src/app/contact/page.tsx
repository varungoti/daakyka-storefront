import { ContactForm } from "@/components/contact/contact-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { brand } from "@/data/brand";
import { whatsappHref } from "@/lib/contact/whatsapp";
import { getSiteImage } from "@/lib/media/get-site-image";
import { getSetting } from "@/lib/settings";
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
  // F-154: this ternary used to return "GENERAL" either way — checkout
  // help never actually preset the form's enquiry type to Product Support.
  const defaultType =
    typeMap[params.type as keyof typeof typeMap] ?? (params.intent === "checkout" ? "SUPPORT" : "GENERAL");
  const [heroImage, contactWhatsapp, contactAddress, contactPhone, contactEmail, grievanceName, grievanceDesignation, grievancePhone, grievanceEmail] =
    await Promise.all([
      getSiteImage("contact.banner"),
      getSetting("contact.whatsapp"),
      // F-053: single-sourced from the same admin-editable setting the
      // footer already renders, instead of the separate hard-coded
      // brand.location.addressLine this page used to show (the two could
      // — and did — drift apart, and an admin's Site Controls edit never
      // reached this page).
      getSetting("contact.address"),
      getSetting("contact.phone"),
      getSetting("contact.email"),
      getSetting("grievance.name"),
      getSetting("grievance.designation"),
      getSetting("grievance.phone"),
      getSetting("grievance.email"),
    ]);
  const hasGrievanceOfficer = Boolean(grievanceName && grievancePhone && grievanceEmail);

  return (
    <>
      <PageHeroBand innerClassName="max-w-2xl text-center" image={heroImage}>
        <SectionHeading
          eyebrow="Get in Touch"
          titleAs="h1"
          title={params.intent === "checkout" ? "Need Help With Your Order?" : "Contact DAAKYKA"}
          description={
            params.intent === "checkout"
              ? "Tell us what went wrong at checkout and our team will call or WhatsApp you back — your cart is saved on this device."
              : "Questions about scrubs, hospital linens, school uniforms, or bulk institutional orders? Reach out to Babaji Enterprises."
          }
          align="center"
        />
      </PageHeroBand>

      <PageContentSection>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div className="space-y-6">
            <article className="hover:border-brand hover:shadow-sm transition-colors rounded-3xl border border-border bg-surface-elevated p-6">
              <div className="flex items-start gap-3">
                <MapPin className="mt-1 text-brand" size={22} />
                <div>
                  <h2 className="font-display font-bold text-ink">Visit Us</h2>
                  <p className="mt-2 text-sm text-muted">{contactAddress}</p>
                  <p className="mt-1 text-sm font-medium text-brand">
                    {brand.location.serviceArea} Delivery
                  </p>
                  <p className="mt-3 text-sm text-muted">
                    <a href={`tel:${contactPhone.replace(/\s+/g, "")}`} className="font-semibold text-brand hover:underline">
                      {contactPhone}
                    </a>
                    {" · "}
                    <a href={`mailto:${contactEmail}`} className="font-semibold text-brand hover:underline">
                      {contactEmail}
                    </a>
                  </p>
                </div>
              </div>
            </article>

            <article className="hover:border-brand hover:shadow-sm transition-colors rounded-3xl border border-border bg-surface-elevated p-6">
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

            <article className="hover:border-brand hover:shadow-sm transition-colors rounded-3xl border border-border bg-surface-elevated p-6">
              <div className="flex items-start gap-3">
                <MessageCircle className="mt-1 text-trust" size={22} />
                <div>
                  <h2 className="font-display font-bold text-ink">WhatsApp</h2>
                  <p className="mt-2 text-sm text-muted">
                    Prefer messaging? Start a conversation with our team.
                  </p>
                  <Link
                    href={whatsappHref(contactWhatsapp, brand.web.whatsappMessage)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex text-sm font-semibold text-trust hover:underline"
                  >
                    Open WhatsApp →
                  </Link>
                </div>
              </div>
            </article>

            {/* F-150: a named Grievance Officer with designation, phone and
                email, per the Consumer Protection (E-Commerce) Rules 2020
                r.4(4)-(5) — admin-editable via Settings, and the whole card
                stays hidden (rather than showing a blank line) until the
                owner has actually filled it in. */}
            {hasGrievanceOfficer && (
              <article id="grievance" className="rounded-3xl border border-border bg-surface-elevated p-6">
                <h2 className="font-display font-bold text-ink">Grievance Officer</h2>
                <p className="mt-2 text-sm text-muted">
                  {grievanceName}
                  {grievanceDesignation ? `, ${grievanceDesignation}` : ""}
                </p>
                <p className="mt-1 text-sm text-muted">
                  <a href={`tel:${grievancePhone.replace(/\s+/g, "")}`} className="font-semibold text-brand hover:underline">
                    {grievancePhone}
                  </a>
                  {" · "}
                  <a href={`mailto:${grievanceEmail}`} className="font-semibold text-brand hover:underline">
                    {grievanceEmail}
                  </a>
                </p>
                <p className="mt-2 text-xs text-muted">
                  We acknowledge complaints within 48 hours and resolve them within one month of
                  receipt, per the Consumer Protection (E-Commerce) Rules, 2020.
                </p>
              </article>
            )}

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
      </PageContentSection>
    </>
  );
}
