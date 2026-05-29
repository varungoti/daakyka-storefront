import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";

export const metadata = policyMetadata(
  "Privacy Policy",
  `Privacy policy for ${brand.name} operated by ${brand.legalName}.`,
);

export default function PrivacyPolicyPage() {
  return (
    <PolicyPage
      title="Privacy Policy"
      description={`How ${brand.legalName} collects, uses, and protects your information.`}
    >
      <p>
        We collect information you provide when placing orders, submitting bulk enquiries,
        subscribing to our newsletter, or contacting us — including name, email, phone, and
        organization details where relevant.
      </p>
      <p>
        We use this data to fulfill orders, respond to institutional quotes, send marketing
        communications (with consent), and improve our products and services.
      </p>
      <p>
        We do not sell personal data. Third-party processors (e.g. payment, email, WhatsApp
        providers) receive only what is necessary to perform their services.
      </p>
      <p>
        You may request access, correction, or deletion of your data by contacting us at{" "}
        <a href="/contact" className="text-brand hover:underline">
          our contact page
        </a>
        .
      </p>
    </PolicyPage>
  );
}
