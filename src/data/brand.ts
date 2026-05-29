/**
 * Brand and company facts sourced from https://daakyka.com
 * Babaji Enterprises — Daakyka Apparels, Hyderabad, India
 */
export const brand = {
  name: "DAAKYKA Apparels",
  legalName: "Babaji Enterprises",
  tagline: "Expertly Designed, Meticulously Crafted",
  subtagline: "Quality Uniforms & Linens for Pan India",
  description:
    "Hyderabad-based Babaji Enterprises has been a trusted name in specialized apparel manufacturing for over nine years through our brand, Daakyka Apparels.",
  location: {
    city: "Hyderabad",
    state: "Telangana",
    country: "India",
    addressLine:
      "286, Ridgewood Residency, Road Number 6, Kavuri Hills, Hyderabad, Telangana",
    serviceArea: "Pan India",
  },
  founders: {
    kamal: {
      name: "Kamal Agarwal",
      role: "Production & Sourcing",
      bio: "Specializes in production and sourcing with a keen eye for quality and efficiency — overseeing raw material procurement through final production.",
    },
    dianeshree: {
      name: "Dianeshree Agarwal",
      role: "Creative Direction & Design",
      bio: "Mauritian national with fashion and design studies across Germany, Australia, India, and Mauritius. Brings 20 years of international fashion consulting to lead design development focused on aesthetics, ergonomic comfort, and practical functionality.",
    },
  },
  yearsInBusiness: 9,
  specializations: [
    {
      title: "Hospital Linens & Scrubs",
      description:
        "Hygienic, durable bedsheets, pillow covers, patient gowns, scrubs, aprons, and staff uniforms for demanding healthcare environments.",
      href: "/shop",
      icon: "healthcare",
    },
    {
      title: "School Uniforms",
      description:
        "Smart, comfortable tunics, shirts, trousers, skirts, and pinafores reflecting institutional pride.",
      href: "/bulk-orders",
      icon: "school",
    },
    {
      title: "Sports Uniforms",
      description:
        "High-performance jerseys, shorts, tracksuits, and team kits with breathable fabrics for movement and durability.",
      href: "/bulk-orders",
      icon: "sports",
    },
    {
      title: "Executive & Corporate Wear",
      description:
        "Sophisticated shirts, trousers, skirts, and jackets that enhance professional brand image.",
      href: "/bulk-orders",
      icon: "corporate",
    },
    {
      title: "Made-to-Measure Blazers",
      description:
        "Impeccably tailored blazers for students, faculty, and corporate teams.",
      href: "/shop/bespoke",
      icon: "blazer",
    },
  ],
  clientSectors: [
    { name: "Healthcare", description: "Hospitals, clinics, and diagnostic centers" },
    { name: "Educational Institutions", description: "Schools, colleges, and universities" },
    { name: "Corporate & Infrastructure", description: "Offices, facilities, and teams" },
    { name: "Facility Management", description: "FMS and service provider uniforms" },
    { name: "Hotels & Hospitality", description: "Front-of-house and back-of-house apparel" },
  ],
  valueProps: [
    "Expert Design & Comfort — 20+ years international fashion expertise",
    "Broad Fabric Sourcing — quality materials for feel, durability, and budget",
    "Specialized Stitching Units — precision tailoring and superior finish",
    "Rigorous Quality Control — checks at every production stage",
    "Reliable On-Time Delivery — Pan India fulfillment",
    "Competitive Pricing — exceptional quality at the best value",
  ],
  processSteps: [
    "Design conception led by expert creative direction",
    "Careful fabric sourcing and material selection",
    "Precision cutting and specialized tailoring",
    "Meticulous finishing and quality inspection",
    "Timely Pan India delivery to your institution",
  ],
  web: {
    domain: "https://daakyka.com",
    whatsappMessage:
      "Hi DAAKYKA, I'd like to enquire about uniforms and linens for my organization.",
  },
  announcementMessages: [
    "Pan India Delivery on Institutional Orders",
    "Hospital Linens · Scrubs · School & Corporate Uniforms",
    "Hyderabad-Based · 9+ Years of Trusted Manufacturing",
  ],
} as const;

export const announcementMessages = brand.announcementMessages;
