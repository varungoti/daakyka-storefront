export interface SchemaValidationResult {
  type: string;
  valid: boolean;
  issues: string[];
}

function requireString(
  data: Record<string, unknown>,
  field: string,
  issues: string[],
): boolean {
  const value = data[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`Missing or empty "${field}"`);
    return false;
  }
  return true;
}

export function validateJsonLdObject(data: Record<string, unknown>): SchemaValidationResult {
  const issues: string[] = [];
  const type = typeof data["@type"] === "string" ? data["@type"] : "Unknown";

  if (data["@context"] !== "https://schema.org") {
    issues.push('Missing or invalid "@context" (expected https://schema.org)');
  }

  if (typeof data["@type"] !== "string") {
    issues.push('Missing "@type"');
    return { type, valid: false, issues };
  }

  switch (data["@type"]) {
    case "Organization":
      requireString(data, "name", issues);
      requireString(data, "url", issues);
      break;
    case "WebSite":
      requireString(data, "name", issues);
      requireString(data, "url", issues);
      break;
    case "Product": {
      requireString(data, "name", issues);
      const offers = data.offers as Record<string, unknown> | undefined;
      if (!offers || offers["@type"] !== "Offer") {
        issues.push('Product missing valid "offers" object');
      } else {
        if (typeof offers.price !== "number") issues.push("Offer missing numeric price");
        requireString(offers, "priceCurrency", issues);
      }
      const rating = data.aggregateRating as Record<string, unknown> | undefined;
      if (rating && typeof rating.ratingValue !== "number") {
        issues.push("AggregateRating missing ratingValue");
      }
      break;
    }
    case "BreadcrumbList": {
      const items = data.itemListElement;
      if (!Array.isArray(items) || items.length === 0) {
        issues.push("BreadcrumbList missing itemListElement array");
      }
      break;
    }
    case "FAQPage": {
      const entities = data.mainEntity;
      if (!Array.isArray(entities) || entities.length === 0) {
        issues.push("FAQPage missing mainEntity questions");
      }
      break;
    }
    default:
      break;
  }

  return { type, valid: issues.length === 0, issues };
}

export function summarizeSchemaValidation(results: SchemaValidationResult[]) {
  return {
    total: results.length,
    valid: results.filter((r) => r.valid).length,
    invalid: results.filter((r) => !r.valid).length,
  };
}

export function getGlobalSchemaFixtures() {
  return [
    { label: "Organization", key: "organization" as const },
    { label: "WebSite", key: "website" as const },
    { label: "Sample Product", key: "product" as const },
    { label: "Sample FAQ", key: "faq" as const },
    { label: "Sample Breadcrumb", key: "breadcrumb" as const },
  ];
}
