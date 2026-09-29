import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";
import { getSetting } from "@/lib/settings";

export const metadata = policyMetadata(
  "Privacy Policy",
  `Privacy policy for ${brand.name} operated by ${brand.legalName}.`,
  "/privacy-policy",
);

/**
 * release-hardening F-150/F-312: this page used to be four short
 * paragraphs that named no processor, no country, no retention period, no
 * cookies/storage, no children's-data statement and no consent-withdrawal
 * or Data Protection Board route, and the "Grievance Officer" line named
 * only the brand, not a person. It's now a real, itemised notice, sourced
 * from what the code actually does (see the processor/collection list
 * below) rather than generic boilerplate — and the Grievance Officer
 * section is settings-driven (F-150) so it can be filled in, and shown,
 * without a further code change, and stays hidden rather than showing a
 * placeholder until the owner has actually supplied a name.
 */
export default async function PrivacyPolicyPage() {
  const [grievanceName, grievanceDesignation, grievancePhone, grievanceEmail, contactAddress, contactPhone, contactEmail] =
    await Promise.all([
      getSetting("grievance.name"),
      getSetting("grievance.designation"),
      getSetting("grievance.phone"),
      getSetting("grievance.email"),
      getSetting("contact.address"),
      getSetting("contact.phone"),
      getSetting("contact.email"),
    ]);
  const hasGrievanceOfficer = Boolean(grievanceName && grievancePhone && grievanceEmail);

  return (
    <PolicyPage
      title="Privacy Policy"
      description={`How ${brand.legalName} collects, uses, and protects your information.`}
    >
      <p className="text-xs text-muted">Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long" })}</p>

      <h2 className="mt-2 font-display text-lg font-bold text-ink">What we collect</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Order and shipping details: name, address, phone, email, and what you buy.</li>
        <li>
          Account details, if you register: name, email, and a password (stored only as a
          one-way hash — we never store or can read your actual password).
        </li>
        <li>Reviews you write, including any photos you attach.</li>
        <li>Newsletter, back-in-stock, and bulk/institutional enquiry sign-ups.</li>
        <li>
          Bulk/institutional enquiry details, including your organisation name where relevant.
        </li>
        <li>
          Basic, first-party usage signals — the products you view and items left in your cart —
          tied to a random id we set for your browser session, not to your identity, unless you&apos;re
          signed in.
        </li>
      </ul>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Why we collect it</h2>
      <p>
        To take and fulfil your order, respond to institutional and bulk quotes, run your account,
        moderate and display reviews, send service messages (order updates, back-in-stock alerts)
        and, with your consent, marketing communications, and to keep the store secure and working
        properly.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Who we share it with</h2>
      <p>We do not sell your personal data. We share only what each of the following needs to do its job:</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Razorpay — to process payments.</li>
        <li>Our email provider (Brevo) — to send order, account and marketing emails.</li>
        <li>Our WhatsApp provider (WATI) — for WhatsApp order/service messages, where used.</li>
        <li>Cloudflare — to store and deliver product and review-photo images.</li>
        <li>Vercel — to host and run the website and its servers.</li>
        <li>Supabase — to host our database.</li>
      </ul>
      <p>
        Some of these providers process data outside India (for example, our application servers
        and email provider may run in other countries) as part of how they deliver their service to
        us.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">How long we keep it</h2>
      <p>
        We keep order, account and review records for as long as your account is active or as we
        need them for accounting, warranty, and legal purposes, and delete or anonymise them when
        they&apos;re no longer needed for those purposes. You can ask us to delete your account data at
        any time — see &quot;Your rights&quot; below.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Cookies and browser storage</h2>
      <p>
        We use a small number of first-party cookies to keep you signed in (as a customer or, for
        our team, as an admin), and browser storage (localStorage/sessionStorage) to remember your
        cart, wishlist and currency preference on this device, and a random session id used only for
        the on-site usage signals described above. We don&apos;t use third-party advertising cookies
        or trackers.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Children&apos;s data</h2>
      <p>
        We sell school and kids&apos; uniforms, but purchases are made by an adult or a
        parent/guardian on the child&apos;s behalf. We don&apos;t knowingly collect personal data
        directly from children, and an account can only be registered by the adult placing the
        order.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Your rights</h2>
      <p>
        You can ask us to access, correct, or delete your personal data, or withdraw consent to
        marketing communications at any time (marketing emails also carry an unsubscribe link), by
        writing to us at{" "}
        <a href={`mailto:${contactEmail}`} className="text-brand hover:underline">
          {contactEmail}
        </a>{" "}
        or through{" "}
        <a href="/contact" className="text-brand hover:underline">
          our contact page
        </a>
        . We&apos;ll act on a request within a reasonable time and confirm once it&apos;s done.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">Security</h2>
      <p>
        We take reasonable technical and organisational measures to protect your data, including
        encrypting connections to our site, hashing passwords, and restricting who on our team can
        access customer data.
      </p>

      <h2 className="mt-4 font-display text-lg font-bold text-ink">
        Grievance Redressal (Digital Personal Data Protection Act, 2023)
      </h2>
      {hasGrievanceOfficer ? (
        <>
          <p>
            If you have a complaint or grievance about how we handle your personal data, you may
            write to our Grievance Officer:
          </p>
          <p>
            {grievanceName}
            {grievanceDesignation ? `, ${grievanceDesignation}` : ""}
            <br />
            <a href={`tel:${grievancePhone.replace(/\s+/g, "")}`} className="text-brand hover:underline">
              {grievancePhone}
            </a>
            {" · "}
            <a href={`mailto:${grievanceEmail}`} className="text-brand hover:underline">
              {grievanceEmail}
            </a>
            <br />
            {contactAddress}
          </p>
          <p>
            We acknowledge a complaint within 48 hours and aim to resolve it within one month of
            receipt, per the Consumer Protection (E-Commerce) Rules, 2020. If you&apos;re not
            satisfied with how we&apos;ve handled your complaint, you may also complain to the Data
            Protection Board of India once it is operational under the DPDP Act, 2023.
          </p>
        </>
      ) : (
        <p>
          You may write to us at{" "}
          <a href={`mailto:${contactEmail}`} className="text-brand hover:underline">
            {contactEmail}
          </a>{" "}
          or{" "}
          <a href={`tel:${contactPhone.replace(/\s+/g, "")}`} className="text-brand hover:underline">
            {contactPhone}
          </a>{" "}
          with any complaint about how we handle your personal data, and, once appointed, your named
          Grievance Officer&apos;s direct contact details will appear here. You may also complain to
          the Data Protection Board of India once it is operational under the DPDP Act, 2023.
        </p>
      )}
    </PolicyPage>
  );
}
