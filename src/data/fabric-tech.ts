export interface FabricTechPage {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  definition: string;
  howItWorks: string;
  whyItMatters: string;
  careTips: string[];
  faqs: { question: string; answer: string }[];
}

export const fabricTechPages: FabricTechPage[] = [
  {
    slug: "4-way-stretch",
    title: "4-Way Stretch",
    eyebrow: "Fabric Technology",
    description:
      "Engineered fabric that moves with you in every direction — essential for long shifts and active clinical work.",
    definition:
      "4-way stretch fabric expands and recovers both horizontally and vertically, giving scrubs a flexible, second-skin feel.",
    howItWorks:
      "Elastic fibers are woven into the fabric in cross-directional patterns, allowing the material to stretch with body movement and return to shape without bagging.",
    whyItMatters:
      "Healthcare professionals bend, reach, and move constantly. 4-way stretch reduces restriction, improves comfort, and helps scrubs maintain a polished fit throughout the shift.",
    careTips: [
      "Wash in cold water to preserve elasticity",
      "Avoid high heat when drying",
      "Do not use fabric softener on performance blends",
    ],
    faqs: [
      {
        question: "What is the difference between 2-way and 4-way stretch?",
        answer:
          "2-way stretch moves in one direction, while 4-way stretch flexes both width-wise and length-wise for greater freedom of movement.",
      },
      {
        question: "Will 4-way stretch scrubs lose shape over time?",
        answer:
          "Premium blends with recovery yarns are designed to bounce back after repeated wear and washing when cared for properly.",
      },
    ],
  },
  {
    slug: "liquid-repellent",
    title: "Liquid Repellent",
    eyebrow: "Fabric Technology",
    description:
      "Advanced finish that helps fluids bead on the surface so you stay dry and confident during demanding shifts.",
    definition:
      "Liquid repellent technology uses a durable water-resistant treatment that causes moisture to bead and roll off the fabric surface.",
    howItWorks:
      "A microscopic finish lowers the fabric's surface energy, preventing liquids from soaking in immediately and buying time to clean or change.",
    whyItMatters:
      "Clinical environments expose uniforms to splashes and spills. Repellent finishes add a practical layer of protection and peace of mind.",
    careTips: [
      "Tumble dry low to reactivate some repellent finishes",
      "Avoid heavy bleach that can degrade treatments",
      "Re-treat according to garment care instructions if recommended",
    ],
    faqs: [
      {
        question: "Is liquid repellent the same as waterproof?",
        answer:
          "No. Repellent fabrics resist absorption and bead liquids, but they are not fully waterproof for prolonged exposure.",
      },
    ],
  },
  {
    slug: "anti-microbial",
    title: "Anti Microbial",
    eyebrow: "Fabric Technology",
    description:
      "Built-in protection that helps inhibit odor-causing bacteria for fresher scrubs shift after shift.",
    definition:
      "Antimicrobial fabric treatments reduce the growth of odor-causing microbes on the textile surface.",
    howItWorks:
      "Antimicrobial agents are embedded into fibers or applied as a finish to disrupt microbial activity on the fabric.",
    whyItMatters:
      "Long shifts, high activity, and repeated wear make odor control important for confidence and professionalism.",
    careTips: [
      "Wash after each wear for best hygiene",
      "Use mild detergent without harsh additives",
      "Air dry when possible to extend finish life",
    ],
    faqs: [
      {
        question: "Does antimicrobial fabric replace washing?",
        answer:
          "No. Regular laundering is still required. Antimicrobial finishes support freshness between care cycles.",
      },
    ],
  },
  {
    slug: "eco-fabric",
    title: "EcoFlex™ Sustainable",
    eyebrow: "Fabric Technology",
    description:
      "Sustainable fabric choices designed for performance today and a lighter footprint tomorrow.",
    definition:
      "EcoFlex™ blends prioritize responsible materials and production methods while maintaining the comfort and durability clinicians expect.",
    howItWorks:
      "Recycled or responsibly sourced fibers are engineered into performance textiles that meet clinical durability standards.",
    whyItMatters:
      "Healthcare teams increasingly value brands that align performance with environmental responsibility.",
    careTips: [
      "Follow care labels to maximize garment lifespan",
      "Wash full loads to reduce water use",
      "Repair or recycle uniforms through approved programs where available",
    ],
    faqs: [
      {
        question: "Are sustainable scrubs as durable as conventional ones?",
        answer:
          "Premium eco blends are tested for stretch recovery, color retention, and shift-long performance.",
      },
    ],
  },
  {
    slug: "moisture-wicking",
    title: "Moisture Wicking",
    eyebrow: "Fabric Technology",
    description:
      "Pulls perspiration away from skin to keep you cooler and drier during high-intensity shifts.",
    definition:
      "Moisture-wicking fabrics transport sweat from the skin to the outer surface where it can evaporate more quickly.",
    howItWorks:
      "Hydrophobic fibers move moisture along the fabric structure while the outer layer promotes evaporation.",
    whyItMatters:
      "Temperature regulation and dryness improve comfort during long hours in warm clinical environments.",
    careTips: [
      "Avoid fabric softener which can clog wicking channels",
      "Wash promptly after heavy shifts",
      "Choose low-heat drying to protect fiber performance",
    ],
    faqs: [
      {
        question: "Is moisture wicking the same as breathable?",
        answer:
          "They work together. Wicking moves moisture; breathability allows air flow. Both improve thermal comfort.",
      },
    ],
  },
  {
    slug: "2-way-stretch",
    title: "2-Way Stretch",
    eyebrow: "Fabric Technology",
    description:
      "Targeted stretch in one direction for structured comfort and a clean, tailored drape.",
    definition:
      "2-way stretch fabric stretches primarily in one direction — usually width-wise — while maintaining stability in the other.",
    howItWorks:
      "Elastic yarns are integrated along one axis of the weave, offering give where needed without excessive looseness.",
    whyItMatters:
      "Ideal for professionals who want a sharper silhouette with enough flexibility for daily clinical movement.",
    careTips: [
      "Wash inside out to protect surface finish",
      "Use gentle cycle for structured blends",
      "Iron on low if required by care label",
    ],
    faqs: [
      {
        question: "Who should choose 2-way stretch?",
        answer:
          "Those who prefer a more structured uniform with moderate flexibility rather than maximum range of motion.",
      },
    ],
  },
];

export function getFabricTechPage(slug: string) {
  return fabricTechPages.find((page) => page.slug === slug);
}
