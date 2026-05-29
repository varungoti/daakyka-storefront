import { JsonLdScript } from "@/components/seo/json-ld-script";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";

export function GlobalJsonLd() {
  return (
    <>
      <JsonLdScript data={organizationJsonLd()} />
      <JsonLdScript data={websiteJsonLd()} />
    </>
  );
}
