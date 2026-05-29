import { blogMedia } from "@/data/media/catalog";

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
      "Choosing scrubs is about more than color. Healthcare professionals need garments that breathe, stretch, and maintain a professional appearance through long shifts.",
      "Start with fabric technology. 4-way stretch supports dynamic movement, while moisture-wicking and antimicrobial finishes improve comfort and freshness.",
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
      "Extend the life of liquid-repellent and antimicrobial fabrics with the right wash and care routine.",
    category: "Fabric",
    author: "DAAKYKA Editorial",
    publishedAt: "2026-05-05",
    readTime: "4 min read",
    image: blogMedia.careScrubs,
    content: [
      "Performance scrubs require gentle care to preserve stretch, repellency, and antimicrobial finishes.",
      "Wash in cold water with mild detergent and avoid fabric softeners that can coat technical fibers.",
    ],
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((post) => post.slug === slug);
}
