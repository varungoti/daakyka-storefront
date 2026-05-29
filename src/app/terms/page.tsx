import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";

export const metadata = policyMetadata(
  "Terms of Service",
  `Terms of service for shopping with ${brand.name}.`,
);

export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms of Service"
      description={`Terms governing use of the ${brand.name} website and purchase of our products.`}
    >
      <p>
        By using this website, you agree to these terms. Products are sold by {brand.legalName}{" "}
        under the {brand.name} brand.
      </p>
      <p>
        Product images are representative. Colors may vary slightly due to screen settings and
        fabric batches. Institutional orders are subject to signed quotes and separate terms.
      </p>
      <p>
        We reserve the right to update pricing, product availability, and these terms. Continued
        use of the site constitutes acceptance of updated terms.
      </p>
    </PolicyPage>
  );
}
