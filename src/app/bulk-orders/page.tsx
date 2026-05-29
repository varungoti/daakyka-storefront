import { BulkOrderForm } from "@/components/bulk-orders/bulk-order-form";
import { SectionHeading } from "@/components/ui/section-heading";
import { Building2, MessageCircle, ShieldCheck, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Bulk Orders",
  description: "Hospital and team uniform bulk order enquiries for DAAKYKA Apparels.",
};

export default function BulkOrdersPage() {
  return (
    <>
      <section className="bg-lavender/30 py-16">
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <SectionHeading
            eyebrow="B2B"
            title="Uniforms for Healthcare Teams"
            description="Department-wise uniform planning, logo embroidery, color standardization, and bulk pricing for hospitals, clinics, and nursing colleges."
            align="center"
          />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <BenefitCard icon={Building2} title="Hospital Programs" text="Standardized uniforms across departments with brand consistency." />
            <BenefitCard icon={Users} title="Bulk Pricing" text="Volume-based pricing for teams of any size." />
            <BenefitCard icon={ShieldCheck} title="Quality Assurance" text="Premium fabrics with fit confidence for every role." />
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 lg:grid-cols-[1fr_420px] lg:px-8">
          <div>
            <h2 className="font-display text-2xl font-bold text-ink">Request a Bulk Quote</h2>
            <p className="mt-2 text-muted">
              Complete the form and our team will respond within 1–2 business days.
            </p>
            <div className="mt-8">
              <BulkOrderForm />
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-3xl border border-border bg-white p-6">
              <h3 className="font-display text-lg font-bold text-ink">WhatsApp Enquiry</h3>
              <p className="mt-2 text-sm text-muted">
                Prefer to chat? Reach our bulk orders team directly on WhatsApp.
              </p>
              <Link
                href="https://wa.me/919876543210?text=Hi%20DAAKYKA%2C%20I%27d%20like%20a%20bulk%20uniform%20quote."
                target="_blank"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-trust px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
              >
                <MessageCircle size={18} />
                Chat on WhatsApp
              </Link>
            </div>
            <div className="rounded-3xl border border-border bg-lilac/30 p-6 text-sm text-muted">
              <p className="font-semibold text-ink">What happens next?</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5">
                <li>We review your requirements</li>
                <li>Our team prepares a custom quote</li>
                <li>Sample approval and production timeline</li>
                <li>Delivery and ongoing support</li>
              </ol>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}

function BenefitCard({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Building2;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-6 text-center">
      <Icon className="mx-auto mb-3 text-brand" size={28} />
      <h3 className="font-display font-bold text-ink">{title}</h3>
      <p className="mt-2 text-sm text-muted">{text}</p>
    </div>
  );
}
