import { z } from "zod";

export const bulkOrderSchema = z.object({
  organization: z.string().min(2, "Organization name is required").max(200),
  contactPerson: z.string().min(2, "Contact person is required").max(120),
  email: z.string().email("Valid email is required").max(254),
  phone: z.string().min(8, "Valid phone number is required").max(32),
  city: z.string().max(100).optional(),
  staffCount: z.coerce.number().int().positive().max(1_000_000).optional(),
  productsRequired: z.string().max(500).optional(),
  colorsRequired: z.string().max(500).optional(),
  sizesRequired: z.string().max(500).optional(),
  logoEmbroidery: z.boolean().default(false),
  deliveryTimeline: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  consentGiven: z
    .boolean()
    .refine((value) => value === true, { message: "You must agree to be contacted" }),
});

export type BulkOrderInput = z.infer<typeof bulkOrderSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
  // bcrypt silently truncates input past 72 bytes; capping well under
  // that (and under a reasonable password-manager-generated length)
  // also blocks a trivial large-payload DoS against the hashing step.
  password: z.string().min(8).max(200),
});

export const blogPostSchema = z.object({
  slug: z.string().min(2),
  title: z.string().min(4),
  excerpt: z.string().min(10),
  category: z.string().min(2),
  author: z.string().min(2),
  publishedAt: z.string(),
  readTime: z.string().min(2),
  image: z.string().url(),
  content: z.array(z.string().min(1)).min(1),
  status: z.enum(["DRAFT", "PUBLISHED"]),
});

export const newsletterSchema = z.object({
  email: z.string().email().max(254),
  source: z.string().max(100).optional(),
  consentGiven: z
    .boolean()
    .refine((value) => value === true, { message: "Consent is required" }),
});

export const segmentSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  description: z.string().optional(),
  criteria: z.record(z.string(), z.unknown()).optional(),
});

export const templateSchema = z.object({
  name: z.string().min(2),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  subject: z.string().optional(),
  body: z.string().min(10),
  variables: z.array(z.string()).optional(),
});

export const campaignSchema = z.object({
  name: z.string().min(2),
  channel: z.enum(["EMAIL", "WHATSAPP"]),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "SENT", "CANCELLED"]),
  segmentId: z.string().optional().nullable(),
  templateId: z.string().optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  notes: z.string().optional(),
});

export const testimonialSchema = z.object({
  quote: z.string().min(10),
  name: z.string().min(2),
  title: z.string().min(2),
  rating: z.number().int().min(1).max(5),
  avatar: z.string().url(),
  featured: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int(),
});

export const userUpdateSchema = z.object({
  name: z.string().min(2),
  role: z.enum([
    "SUPER_ADMIN",
    "STORE_OWNER",
    "MARKETING_ADMIN",
    "CATALOG_MANAGER",
    "ORDER_MANAGER",
    "SEO_MANAGER",
    "CONTENT_EDITOR",
    "BULK_ORDER_MANAGER",
    "SUPPORT_AGENT",
    "VIEWER",
  ]),
  active: z.boolean(),
});
