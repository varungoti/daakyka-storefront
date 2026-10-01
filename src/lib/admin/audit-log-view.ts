import type { AdminRole, Prisma } from "@/generated/prisma/client";
import { hasPermission, type Permission } from "@/lib/auth/rbac";
import { formatIstDateOnly, parseIstDateOnly, parseIstDateOnlyExclusiveEnd } from "@/lib/format/datetime";
import { firstParam, parsePageParam, type RawSearchParam } from "@/lib/admin/pagination";

/**
 * F-167: /admin/audit-logs used to print the last 100 raw rows with no way
 * to filter, page, or see *what* changed — `entity · cmugq38i800bk…` with
 * no label or link, and the `metadata` column (a setting's new value, a
 * user's new role) written on 27,000 of 32,000 rows but never shown. These
 * are the plain, DB-free pieces behind the rebuilt page — filter parsing,
 * the Prisma `where`, readable entity/action labels, links to the audited
 * record, and a safe metadata pretty-printer — so they're unit-testable
 * without rendering the page.
 */

// ---------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------

export interface AuditFilters {
  entity?: string;
  action?: string;
  userId?: string;
  /** Inclusive IST calendar day, `YYYY-MM-DD`. */
  from?: string;
  /** Inclusive IST calendar day, `YYYY-MM-DD`. */
  to?: string;
  page: number;
}

/** `entity` / `action` are written by this codebase as snake_case or
 * kebab-case identifiers ("site_setting", "update_status", "bulk-update") —
 * a filter value that isn't one is junk, not a real filter. */
const IDENTIFIER = /^[a-z0-9][a-z0-9_:-]{0,59}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function pick(raw: RawSearchParam, pattern: RegExp): string | undefined {
  const value = firstParam(raw)?.trim();
  return value && pattern.test(value) ? value : undefined;
}

/** A real calendar day, as `YYYY-MM-DD`. `new Date("2026-02-31...")` rolls
 * over to 3 March instead of failing, so a plain parse isn't enough —
 * round-tripping the parsed instant back to its IST day is. */
function pickDay(raw: RawSearchParam): string | undefined {
  const value = pick(raw, DATE_ONLY);
  const parsed = parseIstDateOnly(value);
  return value && parsed && formatIstDateOnly(parsed) === value ? value : undefined;
}

export function parseAuditFilters(params: Record<string, RawSearchParam>): AuditFilters {
  return {
    entity: pick(params.entity, IDENTIFIER),
    action: pick(params.action, IDENTIFIER),
    userId: pick(params.user, ID),
    from: pickDay(params.from),
    to: pickDay(params.to),
    page: parsePageParam(params.page),
  };
}

/** The Prisma `where` for a set of filters. The date range is read as IST
 * calendar days (the store's own time zone — see src/lib/format/
 * datetime.ts), with `to` inclusive of the whole named day. */
export function buildAuditWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const gte = parseIstDateOnly(filters.from);
  const lt = parseIstDateOnlyExclusiveEnd(filters.to);
  return {
    ...(filters.entity ? { entity: filters.entity } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(gte || lt ? { createdAt: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } } : {}),
  };
}

// ---------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  product: "Product",
  product_image: "Product image",
  product_variants: "Product variants",
  category: "Category",
  size_chart: "Size chart",
  media_asset: "Media asset",
  order: "Order",
  customer: "Customer",
  review: "Review",
  discount: "Discount code",
  offer_recommendation: "Offer",
  testimonial: "Testimonial",
  blog_post: "Blog article",
  seo_page_record: "SEO override",
  homepage_section: "Homepage section",
  site_setting: "Site setting",
  user: "Admin user",
  integration: "Integration",
  integration_credential: "Integration credential",
  campaign: "Campaign",
  customer_segment: "Audience segment",
  message_template: "Message template",
  customer_journey: "Journey",
  newsletter_subscriber: "Newsletter subscriber",
  contact_enquiry: "Contact enquiry",
  bulk_order_lead: "Bulk enquiry",
  admin_notification: "Notification",
  hermes_task: "Hermes task",
  hermes_approval: "Hermes approval",
};

/** The `action` values the app writes most often — suggestions for the
 * filter box, which accepts any action (there are one-off ones too, e.g. an
 * order status written as the action). */
export const AUDIT_ACTION_SUGGESTIONS = [
  "create",
  "update",
  "delete",
  "update_status",
  "publish",
  "unpublish",
  "archive",
  "unarchive",
  "activate",
  "deactivate",
  "approve",
  "reject",
  "dispatch",
  "import",
  "export",
  "duplicate",
  "login",
  "login_failed",
  "login_locked",
  "logout",
] as const;

function humanize(identifier: string): string {
  const spaced = identifier.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : identifier;
}

/** "site_setting" -> "Site setting"; an entity this map has never heard of
 * still renders readably instead of as a raw key. */
export function auditEntityLabel(entity: string): string {
  return Object.hasOwn(AUDIT_ENTITY_LABELS, entity) ? AUDIT_ENTITY_LABELS[entity] : humanize(entity);
}

/** "update_status" -> "Update status". */
export function auditActionLabel(action: string): string {
  return humanize(action);
}

/** A cuid is 25 unreadable characters; show enough of the tail to tell two
 * rows apart (the full id stays available as the cell's tooltip). Anything
 * else — a setting key like "shipping.flatRate", "razorpay:KEY_ID" — is
 * already readable and is shown whole. */
export function shortenAuditId(entityId: string): string {
  return /^c[a-z0-9]{24}$/.test(entityId) ? `#${entityId.slice(-6)}` : entityId;
}

// ---------------------------------------------------------------------
// Links to the audited record
// ---------------------------------------------------------------------

interface EntityLinkRule {
  permission: Permission | Permission[];
  /** Admin URL for this entity; null when there is nothing to open. */
  href: (entityId: string | null) => string | null;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A link to one record's own admin page, e.g. `/admin/products/<id>`. */
function detailPage(base: string, permission: Permission | Permission[]): EntityLinkRule {
  return { permission, href: (entityId) => (entityId && SAFE_ID.test(entityId) ? `${base}/${entityId}` : null) };
}

/** A link to the entity's list page — for records with no detail page of
 * their own, or whose entityId isn't a record id (a setting key). */
function listPage(href: string, permission: Permission | Permission[]): EntityLinkRule {
  return { permission, href: () => href };
}

// Each rule's permission is the one the target page itself enforces, so a
// link is only ever shown to a role that can actually open it — the same
// dead-end F-162 removed from the product list.
const ENTITY_LINKS: Record<string, EntityLinkRule> = {
  product: detailPage("/admin/products", "products:manage"),
  product_image: listPage("/admin/products", "products:view"),
  product_variants: detailPage("/admin/products", "products:manage"),
  category: detailPage("/admin/categories", "categories:manage"),
  size_chart: detailPage("/admin/size-charts", "categories:manage"),
  media_asset: listPage("/admin/media", "media:manage"),
  order: detailPage("/admin/orders", "orders:view"),
  customer: detailPage("/admin/customers", "customers:view"),
  review: listPage("/admin/reviews", "reviews:moderate"),
  discount: detailPage("/admin/discounts", "offers:manage"),
  offer_recommendation: detailPage("/admin/offers", "offers:manage"),
  testimonial: detailPage("/admin/testimonials", "testimonials:manage"),
  blog_post: detailPage("/admin/blog", "blog:manage"),
  seo_page_record: detailPage("/admin/seo", "seo:manage"),
  homepage_section: listPage("/admin/homepage", "homepage:manage"),
  site_setting: listPage("/admin/site-controls", ["settings:manage", "settings:marketing"]),
  user: listPage("/admin/users", "users:manage"),
  integration: listPage("/admin/integrations", "integrations:manage"),
  integration_credential: listPage("/admin/integrations", "integrations:manage"),
  campaign: detailPage("/admin/campaigns", "engagement:manage"),
  customer_segment: detailPage("/admin/segments", "engagement:manage"),
  message_template: detailPage("/admin/templates", "engagement:manage"),
  customer_journey: listPage("/admin/journeys", "journeys:manage"),
  contact_enquiry: listPage("/admin/contact-enquiries", "bulk-orders:manage"),
  bulk_order_lead: listPage("/admin/bulk-orders", "bulk-orders:manage"),
  admin_notification: listPage("/admin/notifications", "bulk-orders:manage"),
  hermes_task: listPage("/admin/hermes", "hermes:manage"),
  hermes_approval: listPage("/admin/hermes", "hermes:manage"),
};

/** The admin page for an audited record, or null when it has none or
 * `role` can't open it. */
export function auditEntityHref(role: AdminRole, entity: string, entityId: string | null): string | null {
  const rule = Object.hasOwn(ENTITY_LINKS, entity) ? ENTITY_LINKS[entity] : undefined;
  if (!rule) return null;
  const allowed = Array.isArray(rule.permission)
    ? rule.permission.some((permission) => hasPermission(role, permission))
    : hasPermission(role, rule.permission);
  return allowed ? rule.href(entityId) : null;
}

// ---------------------------------------------------------------------
// Metadata ("what changed")
// ---------------------------------------------------------------------

/** Defence in depth: nothing in this codebase logs a credential into
 * `AuditLog.metadata` (see the "Never log the actual secret value" note in
 * src/lib/integrations/credential-store.ts), but this page prints
 * metadata verbatim, so a future call site that gets it wrong must not
 * leak onto a screen a VIEWER can open. Only a *string* under such a key
 * is masked — a boolean like `{ passwordReset: true }` is a legitimate
 * "what happened" flag and can't carry a secret. */
const SENSITIVE_KEY = /pass(word|phrase)|secret|token|hash|credential|api[_-]?key/i;

const MAX_METADATA_CHARS = 4000;

function redact(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return depth > 6 ? "…" : value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 6) return "…";
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SENSITIVE_KEY.test(key) && typeof inner === "string" ? "[redacted]" : redact(inner, depth + 1),
      ]),
    );
  }
  return value;
}

/** Pretty-printed `AuditLog.metadata` for the "Details" disclosure, or null
 * when there is nothing worth showing. Never throws on a malformed row —
 * logAuditEvent always JSON-stringifies, so a value that doesn't parse
 * isn't something this app wrote and isn't shown. */
export function formatAuditMetadata(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text: string;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || (typeof parsed === "object" && Object.keys(parsed as object).length === 0)) return null;
    text = JSON.stringify(redact(parsed), null, 2);
  } catch {
    return null;
  }
  return text.length > MAX_METADATA_CHARS ? `${text.slice(0, MAX_METADATA_CHARS)}\n…` : text;
}
