import { JsonLdScript } from "@/components/seo/json-ld-script";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";

// F-053: contact details are optional overrides from the same
// admin-editable contact.* settings the footer already renders (fetched
// once in the root layout, which already awaits them for the footer), so
// this never falls back to a second, driftable hard-coded copy.
export function GlobalJsonLd({
  contactAddress,
  contactPhone,
  contactEmail,
}: {
  contactAddress?: string;
  contactPhone?: string;
  contactEmail?: string;
} = {}) {
  return (
    <>
      <JsonLdScript
        data={organizationJsonLd({ address: contactAddress, phone: contactPhone, email: contactEmail })}
      />
      <JsonLdScript data={websiteJsonLd()} />
    </>
  );
}
