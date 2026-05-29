import { z } from "zod";

export const bulkOrderSchema = z.object({
  organization: z.string().min(2, "Organization name is required"),
  contactPerson: z.string().min(2, "Contact person is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(8, "Valid phone number is required"),
  city: z.string().optional(),
  staffCount: z.coerce.number().int().positive().optional(),
  productsRequired: z.string().optional(),
  colorsRequired: z.string().optional(),
  sizesRequired: z.string().optional(),
  logoEmbroidery: z.boolean().default(false),
  deliveryTimeline: z.string().optional(),
  notes: z.string().optional(),
  consentGiven: z
    .boolean()
    .refine((value) => value === true, { message: "You must agree to be contacted" }),
});

export type BulkOrderInput = z.infer<typeof bulkOrderSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
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
  email: z.string().email(),
  source: z.string().optional(),
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
    "SEO_MANAGER",
    "CONTENT_EDITOR",
    "BULK_ORDER_MANAGER",
    "VIEWER",
  ]),
  active: z.boolean(),
});
