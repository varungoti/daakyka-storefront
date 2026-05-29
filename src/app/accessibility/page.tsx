import { PolicyPage, policyMetadata } from "@/components/legal/policy-page";
import { brand } from "@/data/brand";

export const metadata = policyMetadata(
  "Accessibility",
  `Accessibility statement for ${brand.name}.`,
);

export default function AccessibilityPage() {
  return (
    <PolicyPage
      title="Accessibility"
      description={`${brand.name} is committed to making our website usable for all healthcare professionals and institutional buyers.`}
    >
      <p>
        We aim to meet WCAG 2.1 Level AA guidelines including keyboard navigation, sufficient
        color contrast, semantic HTML, and descriptive alt text on product imagery.
      </p>
      <p>
        If you encounter accessibility barriers on our site, please contact us via{" "}
        <a href="/contact?type=support" className="text-brand hover:underline">
          customer support
        </a>{" "}
        and we will work to address the issue promptly.
      </p>
    </PolicyPage>
  );
}
