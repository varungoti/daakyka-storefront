import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";

export const metadata = policyMetadata(
  "Returns",
  `Return and exchange policy for ${brand.name} medical apparel.`,
);

export default function ReturnsPage() {
  return (
    <PolicyPage
      title="Returns & Exchanges"
      description="We want you to love your scrubs. If something isn't right, we're here to help."
    >
      <p>
        Unworn items with original tags may be returned within 30 days of delivery for retail
        orders, subject to inspection.
      </p>
      <p>
        Custom embroidery, bespoke, and institutional bulk orders are made to specification and
        may not be eligible for standard returns unless there is a manufacturing defect.
      </p>
      <p>
        To initiate a return or report a quality issue, reach out via{" "}
        <a href="/contact?type=support" className="text-brand hover:underline">
          customer support
        </a>
        .
      </p>
    </PolicyPage>
  );
}
