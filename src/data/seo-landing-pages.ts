export interface SeoLandingPageConfig {
  slug: string;
  path: string;
  title: string;
  metaDescription: string;
  h1: string;
  intro: string;
  bullets: string[];
  buyingGuide?: string[];
  faqs: { question: string; answer: string }[];
  shopHref: string;
  shopLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  relatedGuides?: string[];
  relatedBlogSlugs?: string[];
  relatedCollections?: string[];
  productCategory?: "tops" | "bottoms" | "sets" | "jackets" | "accessories" | "bespoke";
}

export const fabricSeoRedirects = [
  { path: "/4-way-stretch-scrubs", destination: "/fabric-technology/4-way-stretch" },
  { path: "/2-way-stretch-scrubs", destination: "/fabric-technology/2-way-stretch" },
  { path: "/liquid-repellent-scrubs", destination: "/fabric-technology/liquid-repellent" },
  { path: "/antimicrobial-scrubs", destination: "/fabric-technology/anti-microbial" },
  { path: "/moisture-wicking-scrubs", destination: "/fabric-technology/moisture-wicking" },
  { path: "/breathable-scrubs", destination: "/fabric-technology/moisture-wicking" },
  { path: "/sustainable-medical-apparel", destination: "/fabric-technology/eco-fabric" },
];

export const seoLandingPages: SeoLandingPageConfig[] = [
  {
    slug: "hospital-uniforms",
    path: "/hospital-uniforms",
    title: "Hospital Uniforms & Linens",
    metaDescription:
      "Bulk hospital uniforms, scrubs, patient gowns, and linens by DAAKYKA Apparels — Pan India delivery, logo embroidery, and institutional pricing.",
    h1: "Hospital Uniforms & Linens",
    intro:
      "Babaji Enterprises supplies hospitals and clinics with hygienic scrubs, patient gowns, bedsheets, and staff uniforms — designed for durability, comfort, and professional presentation across India.",
    bullets: [
      "Department-wise color standardization",
      "Logo embroidery and name personalization",
      "Anti-microbial and liquid-repellent fabric options",
      "Pan India fulfillment from Hyderabad",
    ],
    faqs: [
      {
        question: "What is the minimum order for hospital uniforms?",
        answer: "We work with teams of all sizes. Submit a bulk enquiry and our team will share tiered pricing based on staff count and product mix.",
      },
      {
        question: "Do you supply hospital linens as well as scrubs?",
        answer: "Yes — bedsheets, pillow covers, patient gowns, aprons, and staff apparel are all part of our healthcare specialization.",
      },
    ],
    shopHref: "/bulk-orders",
    shopLabel: "Request Hospital Quote",
    secondaryHref: "/shop",
    secondaryLabel: "Browse Scrubs",
  },
  {
    slug: "scrubs-for-men",
    path: "/scrubs-for-men",
    title: "Scrubs for Men",
    metaDescription:
      "Premium men's medical scrubs with 4-way stretch, liquid repellent fabric, and tailored fits. Shop DAAKYKA Apparels.",
    h1: "Scrubs for Men",
    intro:
      "Engineered for long shifts — men's scrub tops, joggers, and sets with performance fabrics that move with you and stay professional shift after shift.",
    bullets: [
      "V-neck, mandarin, and zip-neck styles",
      "Jogger and straight-leg bottom options",
      "4-way stretch and moisture-wicking fabrics",
      "Mix & Match builder for custom sets",
    ],
    faqs: [
      {
        question: "What fit should men choose for 12-hour shifts?",
        answer: "Relaxed tops with tapered joggers offer the best balance of mobility and a polished silhouette for active clinical roles.",
      },
    ],
    shopHref: "/shop?category=tops",
    shopLabel: "Shop Men's Scrubs",
    secondaryHref: "/mix-and-match",
    secondaryLabel: "Build Your Set",
  },
  {
    slug: "scrubs-for-women",
    path: "/scrubs-for-women",
    title: "Scrubs for Women",
    metaDescription:
      "Women's medical scrubs with premium fabrics, refined fits, and personalization. DAAKYKA Apparels — Pan India.",
    h1: "Scrubs for Women",
    intro:
      "From classic V-necks to mandarin collars — women's scrubs designed with international fashion expertise for comfort, function, and style.",
    bullets: [
      "Flattering silhouettes for all body types",
      "Wide color palette for department coding",
      "Custom embroidery available",
      "Bespoke collection for premium roles",
    ],
    faqs: [
      {
        question: "Can I mix tops and bottoms in different sizes?",
        answer: "Yes — use our Mix & Match builder to select separate top and bottom sizes and preview your set before ordering.",
      },
    ],
    shopHref: "/shop?category=tops",
    shopLabel: "Shop Women's Scrubs",
    secondaryHref: "/shop/bespoke",
    secondaryLabel: "Explore Bespoke",
  },
  {
    slug: "nurse-uniforms",
    path: "/nurse-uniforms",
    title: "Nurse Uniforms",
    metaDescription:
      "Premium nurse uniforms and scrubs with anti-microbial fabric, comfortable fits, and Pan India delivery by DAAKYKA Apparels.",
    h1: "Nurse Uniforms & Scrubs",
    intro:
      "Built for nurses who never stop moving — breathable, stretch-ready scrubs with liquid-repellent protection and styles that stay polished through the longest shifts.",
    bullets: [
      "Moisture-wicking and anti-microbial fabrics",
      "Multiple pocket configurations for clinical tools",
      "Department color coding support",
      "Bulk pricing for nursing teams and colleges",
    ],
    faqs: [
      {
        question: "What fabrics are best for nursing shifts?",
        answer: "4-way stretch with moisture-wicking and anti-microbial finishes offer the best combination of comfort, hygiene, and durability.",
      },
    ],
    shopHref: "/shop",
    shopLabel: "Shop Nurse Scrubs",
    secondaryHref: "/fabric-technology",
    secondaryLabel: "Explore Fabric Tech",
  },
  {
    slug: "medical-scrubs",
    path: "/medical-scrubs",
    title: "Medical Scrubs",
    metaDescription:
      "Shop premium medical scrubs online — 4-way stretch, liquid repellent, and bespoke options. DAAKYKA Apparels, Pan India.",
    h1: "Premium Medical Scrubs",
    intro:
      "DAAKYKA medical scrubs combine fabric science with refined design — for doctors, nurses, technicians, and healthcare teams who demand more from their uniforms.",
    bullets: [
      "Shop tops, bottoms, sets, and jackets",
      "Mix & Match builder with live preview",
      "INR pricing with optional USD display",
      "Institutional and bulk order programs",
    ],
    faqs: [
      {
        question: "Are DAAKYKA scrubs suitable for hospital procurement?",
        answer: "Yes — we supply both individual retail orders and institutional programs with embroidery, color standards, and Pan India delivery.",
      },
    ],
    shopHref: "/shop",
    shopLabel: "Shop Medical Scrubs",
    secondaryHref: "/mix-and-match",
    secondaryLabel: "Build Your Set",
  },
  {
    slug: "custom-embroidered-scrubs",
    path: "/custom-embroidered-scrubs",
    title: "Custom Embroidered Scrubs",
    metaDescription:
      "Personalized embroidered medical scrubs with name and logo options. DAAKYKA Mix & Match builder — Pan India.",
    h1: "Custom Embroidered Scrubs",
    intro:
      "Add your name, credentials, or department logo — our Mix & Match builder lets you preview embroidery placement before you order.",
    bullets: [
      "Name and title embroidery",
      "Hospital and department logo programs",
      "Bulk embroidery for institutional orders",
      "Premium thread colors to match brand guidelines",
    ],
    faqs: [
      {
        question: "Can I preview embroidery before ordering?",
        answer: "Yes — use the Mix & Match builder to enter your name and see it on your selected top style.",
      },
    ],
    shopHref: "/mix-and-match",
    shopLabel: "Open Mix & Match Builder",
    secondaryHref: "/bulk-orders",
    secondaryLabel: "Bulk Embroidery Quote",
  },
  {
    slug: "best-scrubs-for-long-shifts",
    path: "/best-scrubs-for-long-shifts",
    title: "Best Scrubs for Long Shifts",
    metaDescription:
      "How to choose scrubs for 12-hour shifts — fabric, fit, and features that matter. Guide by DAAKYKA Apparels.",
    h1: "Best Scrubs for Long Shifts",
    intro:
      "Twelve-hour shifts demand scrubs that breathe, stretch, and resist stains. Here is what healthcare professionals should prioritize when choosing workwear.",
    bullets: [
      "4-way stretch for unrestricted movement",
      "Moisture-wicking to stay dry under pressure",
      "Liquid-repellent finishes for spill protection",
      "Relaxed fits that maintain a professional silhouette",
    ],
    faqs: [
      {
        question: "What is the best scrub fit for active clinical roles?",
        answer: "Athletic-fit joggers paired with a relaxed top balance mobility with a clean, professional look.",
      },
      {
        question: "How should I care for performance scrubs?",
        answer: "Wash in cold water, avoid fabric softener on technical weaves, and tumble dry low to preserve repellent and stretch properties.",
      },
    ],
    shopHref: "/fabric-technology/4-way-stretch",
    shopLabel: "Explore 4-Way Stretch",
    secondaryHref: "/blog/how-to-choose-medical-scrubs",
    secondaryLabel: "Read Full Guide",
  },
  {
    slug: "doctor-scrubs",
    path: "/doctor-scrubs",
    title: "Doctor Scrubs",
    metaDescription:
      "Premium doctor scrubs with refined fits, 4-way stretch, and liquid-repellent fabrics. Shop DAAKYKA Apparels — Pan India.",
    h1: "Doctor Scrubs",
    intro:
      "From rounds to procedures — doctor scrubs that balance authority, comfort, and performance fabric technology for demanding clinical schedules.",
    bullets: [
      "Mandarin and V-neck styles for professional presentation",
      "4-way stretch for unrestricted movement during procedures",
      "Liquid-repellent and anti-microbial fabric options",
      "Custom embroidery for name and credentials",
    ],
    faqs: [
      {
        question: "What scrub styles do doctors prefer?",
        answer: "Mandarin collar and zip-neck tops paired with tapered joggers are popular for a polished, modern clinical look.",
      },
      {
        question: "Can hospitals standardize doctor scrubs by department?",
        answer: "Yes — we support department color coding, logo embroidery, and bulk procurement programs with Pan India delivery.",
      },
    ],
    shopHref: "/shop?category=sets",
    shopLabel: "Shop Doctor Scrubs",
    secondaryHref: "/mandarin-collar-scrubs",
    secondaryLabel: "Mandarin Collar Styles",
  },
  {
    slug: "scrub-tops",
    path: "/scrub-tops",
    title: "Scrub Tops",
    metaDescription:
      "Medical scrub tops — V-neck, mandarin, zip-neck, and bespoke styles with 4-way stretch. DAAKYKA Apparels.",
    h1: "Scrub Tops",
    intro:
      "The right scrub top sets the tone for your shift. Browse performance tops engineered for stretch, breathability, and a clean professional silhouette.",
    bullets: [
      "V-neck, mandarin collar, and zip-neck silhouettes",
      "Multiple pocket layouts for clinical essentials",
      "Mix & Match with any bottom size",
      "Embroidery for name and department branding",
    ],
    faqs: [
      {
        question: "How do I choose between V-neck and mandarin collar tops?",
        answer: "V-necks offer classic versatility; mandarin collars deliver a sharper, contemporary look favored in premium hospital settings.",
      },
    ],
    productCategory: "tops",
    shopHref: "/shop?category=tops",
    shopLabel: "Shop Scrub Tops",
    secondaryHref: "/mix-and-match",
    secondaryLabel: "Build Your Set",
  },
  {
    slug: "scrub-pants",
    path: "/scrub-pants",
    title: "Scrub Pants",
    metaDescription:
      "Medical scrub pants and joggers with 4-way stretch, drawstring comfort, and liquid-repellent finishes. DAAKYKA Apparels.",
    h1: "Scrub Pants",
    intro:
      "From straight-leg classics to athletic joggers — scrub bottoms built for 12-hour shifts with stretch, secure pockets, and easy care.",
    bullets: [
      "Jogger and straight-leg fits",
      "Drawstring and elastic waistbands for all-day comfort",
      "Reinforced seams for durability",
      "Pair any bottom with tops via Mix & Match",
    ],
    faqs: [
      {
        question: "Jogger vs straight-leg scrub pants — which is better?",
        answer: "Joggers suit active clinical roles with tapered ankles; straight-leg pants offer a traditional fit preferred in many hospital dress codes.",
      },
    ],
    shopHref: "/shop?category=bottoms",
    shopLabel: "Shop Scrub Pants",
    secondaryHref: "/jogger-scrub-pants",
    secondaryLabel: "Explore Joggers",
  },
  {
    slug: "jogger-scrub-pants",
    path: "/jogger-scrub-pants",
    title: "Jogger Scrub Pants",
    metaDescription:
      "Athletic jogger scrub pants with 4-way stretch, tapered fit, and moisture-wicking fabric. DAAKYKA Apparels — Pan India.",
    h1: "Jogger Scrub Pants",
    intro:
      "The modern scrub bottom — tapered joggers with stretch fabric that moves with you through rounds, procedures, and long shifts on your feet.",
    bullets: [
      "Tapered ankle for a clean, athletic silhouette",
      "4-way stretch and moisture-wicking performance",
      "Secure zip or cargo pockets",
      "Available across men's and women's sizing",
    ],
    faqs: [
      {
        question: "Are jogger scrubs acceptable in hospitals?",
        answer: "Many modern hospitals accept jogger-style scrubs; confirm your institution's dress code — we offer both joggers and straight-leg options.",
      },
    ],
    shopHref: "/shop?category=bottoms",
    shopLabel: "Shop Jogger Scrubs",
    secondaryHref: "/best-scrubs-for-long-shifts",
    secondaryLabel: "Long Shift Guide",
  },
  {
    slug: "mandarin-collar-scrubs",
    path: "/mandarin-collar-scrubs",
    title: "Mandarin Collar Scrubs",
    metaDescription:
      "Mandarin collar medical scrubs with premium fabrics and refined fits. Stand out with DAAKYKA Apparels.",
    h1: "Mandarin Collar Scrubs",
    intro:
      "A sharper alternative to the classic V-neck — mandarin collar scrubs deliver contemporary elegance for doctors, specialists, and premium healthcare roles.",
    bullets: [
      "Stand-up collar for a distinguished clinical look",
      "Premium fabric options including bespoke collection",
      "Ideal for leadership and specialist roles",
      "Custom embroidery available",
    ],
    faqs: [
      {
        question: "Who wears mandarin collar scrubs?",
        answer: "Doctors, department heads, and specialists often choose mandarin collars for a polished appearance that still meets clinical function requirements.",
      },
    ],
    shopHref: "/shop/bespoke",
    shopLabel: "Shop Mandarin Styles",
    secondaryHref: "/doctor-scrubs",
    secondaryLabel: "Doctor Scrubs Guide",
  },
  {
    slug: "bulk-hospital-uniforms",
    path: "/bulk-hospital-uniforms",
    title: "Bulk Hospital Uniforms",
    metaDescription:
      "Bulk hospital uniform programs — scrubs, linens, embroidery, and Pan India delivery. Quote from DAAKYKA Apparels.",
    h1: "Bulk Hospital Uniforms",
    intro:
      "Outfit your entire hospital — scrubs, patient gowns, linens, and staff apparel with standardized colors, logo embroidery, and tiered institutional pricing.",
    bullets: [
      "Department-wise color and style standards",
      "Logo and name embroidery at scale",
      "Scrubs, gowns, bedsheets, and aprons",
      "Dedicated account support from Hyderabad",
    ],
    faqs: [
      {
        question: "What is the minimum staff count for bulk pricing?",
        answer: "We work with teams of all sizes — submit a bulk enquiry with your staff count and product requirements for a tailored quote.",
      },
      {
        question: "Do you deliver across India?",
        answer: "Yes — Babaji Enterprises fulfills institutional orders Pan India from our Hyderabad operations.",
      },
    ],
    shopHref: "/bulk-orders",
    shopLabel: "Request Bulk Quote",
    secondaryHref: "/institutional",
    secondaryLabel: "Institutional Solutions",
  },
  {
    slug: "best-scrubs-for-doctors",
    path: "/best-scrubs-for-doctors",
    title: "Best Scrubs for Doctors",
    metaDescription:
      "How to choose the best scrubs for doctors — fit, fabric, and features that matter. Guide by DAAKYKA Apparels.",
    h1: "Best Scrubs for Doctors",
    intro:
      "Doctors need scrubs that project professionalism while surviving long shifts. Here is what to prioritize when selecting clinical workwear.",
    bullets: [
      "Mandarin or zip-neck tops for a refined silhouette",
      "4-way stretch for procedure-room mobility",
      "Liquid-repellent finishes for spill protection",
      "Embroidery for credentials and department identity",
    ],
    faqs: [
      {
        question: "What fabric is best for doctor scrubs?",
        answer: "4-way stretch with moisture-wicking and liquid-repellent treatments offers the best balance of comfort, hygiene, and durability.",
      },
    ],
    shopHref: "/doctor-scrubs",
    shopLabel: "Shop Doctor Scrubs",
    secondaryHref: "/fabric-technology",
    secondaryLabel: "Explore Fabric Tech",
  },
  {
    slug: "best-scrubs-for-nurses",
    path: "/best-scrubs-for-nurses",
    title: "Best Scrubs for Nurses",
    metaDescription:
      "Best scrubs for nurses — comfort, pockets, and fabric for 12-hour shifts. Guide by DAAKYKA Apparels.",
    h1: "Best Scrubs for Nurses",
    intro:
      "Nurses are on their feet all day — the best scrubs combine breathable stretch fabric, practical pockets, and fits that stay comfortable through every shift.",
    bullets: [
      "Moisture-wicking and anti-microbial fabrics",
      "Multiple pocket configurations for clinical tools",
      "Relaxed tops with tapered joggers for mobility",
      "Department color options for team identification",
    ],
    faqs: [
      {
        question: "How many pockets do nurses need in scrubs?",
        answer: "At minimum two side pockets plus a chest pocket; cargo-style options add utility for nurses carrying multiple clinical tools.",
      },
    ],
    shopHref: "/nurse-uniforms",
    shopLabel: "Shop Nurse Scrubs",
    secondaryHref: "/best-scrubs-for-long-shifts",
    secondaryLabel: "Long Shift Guide",
  },
  {
    slug: "how-to-find-scrub-size",
    path: "/how-to-find-scrub-size",
    title: "How to Find Your Scrub Size",
    metaDescription:
      "Scrub sizing guide — measure for the perfect fit. DAAKYKA size guide for men's and women's medical scrubs.",
    h1: "How to Find Your Scrub Size",
    intro:
      "Ill-fitting scrubs distract from patient care. Use our sizing approach to match your measurements to the right top and bottom sizes — mix sizes freely with Mix & Match.",
    bullets: [
      "Measure chest, waist, and hip for accurate sizing",
      "Tops and bottoms can be different sizes",
      "Relaxed vs athletic fit guidance by role",
      "XXS through 5XL available across styles",
    ],
    faqs: [
      {
        question: "Should scrub tops and bottoms be the same size?",
        answer: "Not necessarily — many professionals wear a different top and bottom size. Use Mix & Match to select each piece independently.",
      },
      {
        question: "What if I'm between sizes?",
        answer: "For tops, size up if you layer under scrubs; for joggers, refer to waist measurement and preferred fit (relaxed vs tapered).",
      },
    ],
    shopHref: "/size-guide",
    shopLabel: "Open Size Guide",
    secondaryHref: "/mix-and-match",
    secondaryLabel: "Build Your Set",
  },
  {
    slug: "how-to-choose-medical-scrubs",
    path: "/how-to-choose-medical-scrubs",
    title: "How to Choose Medical Scrubs",
    metaDescription:
      "Fit, fabric, and function — how to choose medical scrubs for long clinical shifts. Expert guide by DAAKYKA Apparels.",
    h1: "How to Choose Medical Scrubs",
    intro:
      "The right scrubs improve comfort, confidence, and focus through every shift. Prioritize fabric technology, fit for your role, and care requirements before color or style.",
    bullets: [
      "4-way stretch for active clinical movement",
      "Moisture-wicking and anti-microbial for long shifts",
      "Mix & Match separate top and bottom sizes",
      "Institutional programs for hospital teams",
    ],
    buyingGuide: [
      "Start with fabric — 4-way stretch and liquid-repellent finishes suit high-activity roles.",
      "Choose fit by role — relaxed tops with joggers for nurses; mandarin collars for doctors.",
      "Confirm pocket layout matches your clinical tool carry needs.",
      "Check care labels — performance fabrics need cold wash and low-heat dry.",
    ],
    faqs: [
      {
        question: "What is the most important factor when choosing scrubs?",
        answer: "Fabric performance — stretch, breathability, and repellency — has the biggest impact on comfort across a full shift.",
      },
      {
        question: "Should I buy scrub sets or mix tops and bottoms?",
        answer: "Mix & Match lets you choose different sizes and styles for top and bottom, which most professionals prefer.",
      },
    ],
    shopHref: "/shop",
    shopLabel: "Shop Medical Scrubs",
    secondaryHref: "/blog/how-to-choose-medical-scrubs",
    secondaryLabel: "Read Full Article",
    relatedGuides: ["how-to-find-scrub-size", "best-scrubs-for-long-shifts", "medical-scrubs"],
    relatedBlogSlugs: ["how-to-choose-medical-scrubs"],
    relatedCollections: ["best-sellers", "stretch-collection"],
  },
  {
    slug: "how-to-wash-medical-scrubs",
    path: "/how-to-wash-medical-scrubs",
    title: "How to Wash Medical Scrubs",
    metaDescription:
      "Care guide for performance medical scrubs — preserve stretch, repellency, and antimicrobial finishes. DAAKYKA Apparels.",
    h1: "How to Wash Medical Scrubs",
    intro:
      "Performance scrubs need the right wash routine to preserve 4-way stretch, liquid-repellent coatings, and anti-microbial treatments shift after shift.",
    bullets: [
      "Cold water wash protects elastic fibers",
      "Skip fabric softener on technical weaves",
      "Low-heat tumble dry or air dry",
      "Wash after each clinical shift for hygiene",
    ],
    buyingGuide: [
      "Pre-treat stains promptly — avoid harsh bleach on repellent finishes.",
      "Turn garments inside out to protect surface treatments.",
      "Wash scrubs separately from heavily soiled laundry when possible.",
      "Hang or fold promptly to reduce wrinkles without high-heat ironing.",
    ],
    faqs: [
      {
        question: "Can I use fabric softener on scrub uniforms?",
        answer: "Avoid fabric softener on moisture-wicking and liquid-repellent scrubs — it coats fibers and reduces performance.",
      },
      {
        question: "How often should medical scrubs be washed?",
        answer: "After every shift. Regular laundering is essential even with antimicrobial fabric treatments.",
      },
    ],
    shopHref: "/fabric-technology",
    shopLabel: "Explore Fabric Tech",
    secondaryHref: "/blog/caring-for-performance-scrubs",
    secondaryLabel: "Read Care Article",
    relatedGuides: ["best-scrubs-for-long-shifts", "what-is-4-way-stretch-fabric"],
    relatedBlogSlugs: ["caring-for-performance-scrubs"],
    relatedCollections: ["stretch-collection"],
  },
  {
    slug: "scrubs-vs-lab-coat",
    path: "/scrubs-vs-lab-coat",
    title: "Scrubs vs Lab Coat",
    metaDescription:
      "Scrubs vs lab coats — when to wear each, pros and cons, and how hospitals combine both. Guide by DAAKYKA Apparels.",
    h1: "Scrubs vs Lab Coat",
    intro:
      "Scrubs and lab coats serve different roles in clinical dress codes. Understanding when each is required helps professionals and procurement teams outfit staff correctly.",
    bullets: [
      "Scrubs — primary shift uniform for most clinical roles",
      "Lab coats — added layer for consultations and formal rounds",
      "Many hospitals require both for doctors and specialists",
      "DAAKYKA supplies scrubs; partner with your coat program as needed",
    ],
    buyingGuide: [
      "Check your hospital dress code before purchasing — requirements vary by department.",
      "Scrubs handle daily wear, spills, and high-activity tasks.",
      "Lab coats add a professional layer for patient-facing consultations.",
      "Color-coordinate scrubs with institutional standards for team identity.",
    ],
    faqs: [
      {
        question: "Do doctors wear scrubs or lab coats?",
        answer: "Many doctors wear scrubs during procedures and add a lab coat for rounds or outpatient consultations — policies vary by institution.",
      },
      {
        question: "Are scrubs more comfortable than lab coats for long shifts?",
        answer: "Scrubs are designed for all-day wear with stretch and moisture management; lab coats are typically worn as an outer layer.",
      },
    ],
    shopHref: "/doctor-scrubs",
    shopLabel: "Shop Doctor Scrubs",
    secondaryHref: "/hospital-uniforms",
    secondaryLabel: "Hospital Uniforms",
    relatedGuides: ["doctor-scrubs", "nurse-uniforms", "hospital-uniforms"],
    relatedCollections: ["hospital-teams"],
  },
  {
    slug: "best-colors-for-hospital-uniforms",
    path: "/best-colors-for-hospital-uniforms",
    title: "Best Colors for Hospital Uniforms",
    metaDescription:
      "Hospital uniform color guide — department coding, psychology, and practical choices. DAAKYKA Apparels Pan India.",
    h1: "Best Colors for Hospital Uniforms",
    intro:
      "Uniform color communicates department identity, professionalism, and team cohesion. The right palette balances hospital standards with practical wear-and-care considerations.",
    bullets: [
      "Navy and charcoal — authority and stain concealment",
      "Lilac, sage, and teal — approachable patient-facing tones",
      "Department color coding for role identification",
      "Bulk programs with consistent dye lots across reorders",
    ],
    buyingGuide: [
      "Align with existing hospital brand and department standards.",
      "Choose darker tones for high-spill roles; lighter tones for admin-facing teams.",
      "Plan enough color variation to distinguish departments without visual chaos.",
      "Request fabric swatches before large institutional orders.",
    ],
    faqs: [
      {
        question: "What are the most popular scrub colors in Indian hospitals?",
        answer: "Navy, ceil blue, teal, and lilac are common — many institutions standardize by department for quick role recognition.",
      },
      {
        question: "Can we customize colors for our hospital brand?",
        answer: "Yes — bulk and institutional programs support custom color standards with embroidery and Pan India fulfillment.",
      },
    ],
    shopHref: "/bulk-orders",
    shopLabel: "Request Bulk Quote",
    secondaryHref: "/blog/best-colors-for-hospital-uniforms",
    secondaryLabel: "Read Full Article",
    relatedGuides: ["hospital-uniforms", "bulk-hospital-uniforms", "nurse-uniforms"],
    relatedBlogSlugs: ["best-colors-for-hospital-uniforms"],
    relatedCollections: ["hospital-teams"],
  },
  {
    slug: "what-is-4-way-stretch-fabric",
    path: "/what-is-4-way-stretch-fabric",
    title: "What Is 4-Way Stretch Fabric",
    metaDescription:
      "What is 4-way stretch fabric in medical scrubs — definition, benefits, and care. DAAKYKA fabric technology guide.",
    h1: "What Is 4-Way Stretch Fabric?",
    intro:
      "4-way stretch is a performance textile that expands and recovers both horizontally and vertically — the foundation of modern clinical comfort for active healthcare roles.",
    bullets: [
      "Stretches width-wise and length-wise for full mobility",
      "Maintains shape recovery after repeated wear",
      "Essential for bending, reaching, and long shifts",
      "Pairs with moisture-wicking and repellent finishes",
    ],
    buyingGuide: [
      "Choose 4-way stretch for high-activity roles — nurses, ER, surgery support.",
      "Compare with 2-way stretch if you prefer a more structured drape.",
      "Verify care instructions to preserve elasticity over time.",
      "Try Mix & Match to pair stretch tops with jogger bottoms.",
    ],
    faqs: [
      {
        question: "What is the difference between 2-way and 4-way stretch?",
        answer: "2-way stretch moves primarily in one direction; 4-way stretch flexes both horizontally and vertically for greater freedom of movement.",
      },
      {
        question: "Does 4-way stretch lose elasticity over time?",
        answer: "Premium blends with recovery yarns maintain shape when washed in cold water and dried on low heat without fabric softener.",
      },
    ],
    shopHref: "/fabric-technology/4-way-stretch",
    shopLabel: "Explore 4-Way Stretch",
    secondaryHref: "/shop?fabric=4-way-stretch",
    secondaryLabel: "Shop Stretch Scrubs",
    relatedGuides: ["best-scrubs-for-long-shifts", "jogger-scrub-pants", "how-to-wash-medical-scrubs"],
    relatedCollections: ["stretch-collection"],
  },
];

export const collectionPages = [
  {
    handle: "best-sellers",
    title: "Best Sellers",
    description: "Our most-loved scrubs chosen by healthcare professionals.",
    shopQuery: { featured: "true" },
  },
  {
    handle: "stretch-collection",
    title: "Stretch Collection",
    description: "4-way stretch scrubs built for movement and all-day comfort.",
    shopHref: "/fabric-technology/4-way-stretch",
  },
  {
    handle: "hospital-teams",
    title: "Hospital Teams",
    description: "Institutional uniforms and linens for healthcare organizations.",
    shopHref: "/hospital-uniforms",
  },
  {
    handle: "bespoke",
    title: "Bespoke Collection",
    description: "Luxury limited-edition scrubs with premium fabrics.",
    shopHref: "/shop/bespoke",
  },
];

export function getSeoLandingPage(slug: string) {
  return seoLandingPages.find((p) => p.slug === slug);
}

export function getCollection(handle: string) {
  return collectionPages.find((c) => c.handle === handle);
}

export function getSeoGuideGroups() {
  const commercial = [
    "medical-scrubs",
    "doctor-scrubs",
    "nurse-uniforms",
    "hospital-uniforms",
    "scrubs-for-men",
    "scrubs-for-women",
    "scrub-tops",
    "scrub-pants",
    "jogger-scrub-pants",
    "mandarin-collar-scrubs",
    "custom-embroidered-scrubs",
    "bulk-hospital-uniforms",
  ];
  const intent = [
    "how-to-choose-medical-scrubs",
    "how-to-find-scrub-size",
    "how-to-wash-medical-scrubs",
    "best-scrubs-for-doctors",
    "best-scrubs-for-nurses",
    "best-scrubs-for-long-shifts",
    "scrubs-vs-lab-coat",
    "best-colors-for-hospital-uniforms",
    "what-is-4-way-stretch-fabric",
  ];

  const bySlug = (slugs: string[]) =>
    slugs
      .map((slug) => seoLandingPages.find((p) => p.slug === slug))
      .filter((p): p is SeoLandingPageConfig => Boolean(p));

  return {
    commercial: bySlug(commercial),
    intent: bySlug(intent),
  };
}

export function resolveSeoRelated(page: SeoLandingPageConfig) {
  const guides = (page.relatedGuides ?? [])
    .map((slug) => seoLandingPages.find((p) => p.slug === slug))
    .filter((p): p is SeoLandingPageConfig => Boolean(p));

  const collections = (page.relatedCollections ?? [])
    .map((handle) => collectionPages.find((c) => c.handle === handle))
    .filter((c): c is (typeof collectionPages)[number] => Boolean(c));

  return { guides, collections, blogSlugs: page.relatedBlogSlugs ?? [] };
}
