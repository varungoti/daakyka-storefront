import { blogMedia } from "@/data/media/catalog";

/**
 * F-051: SEED INPUT AND TYPES ONLY. The journal is read from the database
 * (src/lib/blog/index.ts) — nothing at runtime may import `blogPosts` from
 * here to serve a page, a listing or a link, because this file keeps a post
 * alive after the admin has unpublished or deleted it. It remains for the
 * `BlogPost` type and as the reference launch copy that tests (slug and
 * canonical checks) read; prisma/seed.ts keeps its own copy for seeding.
 */
export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  author: string;
  publishedAt: string;
  readTime: string;
  image: string;
  content: string[];
}

export const blogPosts: BlogPost[] = [
  {
    slug: "how-to-choose-medical-scrubs",
    title: "How to Choose Medical Scrubs That Last Long Shifts",
    excerpt:
      "Fit, fabric, and function — the three factors that matter most when choosing scrubs for demanding clinical work.",
    category: "Fit Guide",
    author: "DAAKYKA Editorial",
    publishedAt: "2026-05-20",
    readTime: "6 min read",
    image: blogMedia.chooseScrubs,
    content: [
      "Choosing scrubs is about more than color. Healthcare professionals need garments that breathe and maintain a professional appearance through long shifts.",
      "Start with fabric. A durable poly-cotton blend holds up to daily hospital laundering better than lighter, purely fashion-driven fabrics.",
      "Next, evaluate fit. A relaxed top with a tapered jogger may suit active roles, while straight pants offer a more traditional silhouette.",
      "Finally, consider care requirements. Easy-care fabrics reduce time spent maintaining uniforms outside of work.",
    ],
  },
  {
    slug: "best-colors-for-hospital-uniforms",
    title: "Best Colors for Hospital Uniforms",
    excerpt:
      "Color psychology, department standards, and practical considerations for hospital apparel programs.",
    category: "Style",
    author: "DAAKYKA Editorial",
    publishedAt: "2026-05-12",
    readTime: "5 min read",
    image: blogMedia.hospitalColors,
    content: [
      "Color choices in healthcare settings influence patient perception, team cohesion, and practical maintenance.",
      "Soft lilac and navy tones communicate calm professionalism, while deeper plum accents signal premium bespoke collections.",
      "For bulk hospital programs, standardized palettes simplify procurement and reinforce institutional identity.",
    ],
  },
  {
    slug: "caring-for-performance-scrubs",
    title: "Caring for Performance Scrubs",
    excerpt:
      "Extend the life of your scrubs with the right wash and care routine.",
    category: "Fabric",
    author: "DAAKYKA Editorial",
    publishedAt: "2026-05-05",
    readTime: "4 min read",
    image: blogMedia.careScrubs,
    content: [
      "Scrubs need gentle care to keep their fit, colour, and stitching looking good wash after wash.",
      "Wash in cold water with mild detergent and avoid fabric softeners that can coat fibers over time.",
    ],
  },
];
