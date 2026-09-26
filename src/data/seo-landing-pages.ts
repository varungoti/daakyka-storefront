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
  /** release-hardening audit F-003: was a fixed union of the legacy seed
   * catalog's categories ("tops"/"bespoke"/...), none of which are real DB
   * category slugs — getProductsByCategory now returns `[]` for an unknown
   * slug rather than falling back to that seed data, so this must be a
   * real `Category.slug` (e.g. "scrub-tops", "scrub-pants", "scrub-sets"). */
  productCategory?: string;
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
      "Fluid-resistant OT gowns and easy-care poly-cotton uniforms",
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
    productCategory: "for-hospitals",
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
      "Premium men's medical scrub sets, tops, and joggers with tailored fits and durable poly-cotton fabric. Shop DAAKYKA Apparels.",
    h1: "Scrubs for Men",
    intro:
      "Engineered for long shifts — men's scrub tops, joggers, and sets in durable fabric that stays comfortable and professional shift after shift.",
    bullets: [
      "V-neck, mandarin, and zip-neck styles",
      "Jogger and straight-leg bottom options",
      "Durable poly-cotton 65/35 fabric for daily wear",
      "Multiple pocket layouts for clinical tools",
    ],
    faqs: [
      {
        question: "What fit should men choose for 12-hour shifts?",
        answer: "Relaxed tops with tapered joggers offer the best balance of mobility and a polished silhouette for active clinical roles.",
      },
    ],
    productCategory: "scrub-sets",
    shopHref: "/category/scrub-sets",
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
      "Tailored fits for a polished, professional silhouette",
    ],
    faqs: [
      {
        question: "Can I mix tops and bottoms in different sizes?",
        answer: "Yes — scrub tops and pants are sold separately, so you can choose the size that fits each best.",
      },
    ],
    productCategory: "scrub-sets",
    shopHref: "/category/scrub-sets",
    shopLabel: "Shop Women's Scrubs",
    // release-hardening audit F-003: /shop/bespoke has no real catalogue
    // behind it yet — repointed to the enquiry flow a "bespoke" request
    // actually needs (see that page's own comment).
    secondaryHref: "/bulk-orders",
    secondaryLabel: "Explore Bespoke",
  },
  {
    slug: "nurse-uniforms",
    path: "/nurse-uniforms",
    title: "Nurse Uniforms",
    metaDescription:
      "Premium nurse uniforms and scrubs with durable fabric, comfortable fits, and Pan India delivery by DAAKYKA Apparels.",
    h1: "Nurse Uniforms & Scrubs",
    intro:
      "Built for nurses who never stop moving — comfortable, easy-care scrubs in styles that stay polished through the longest shifts.",
    bullets: [
      "Breathable poly-cotton 65/35 fabric",
      "Multiple pocket configurations for clinical tools",
      "Department color coding support",
      "Bulk pricing for nursing teams and colleges",
    ],
    faqs: [
      {
        question: "What fabrics are best for nursing shifts?",
        answer: "A relaxed poly-cotton scrub with a tapered jogger and multiple pockets balances comfort, storage, and a professional look across a long shift.",
      },
    ],
    productCategory: "scrub-sets",
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
      "Shop premium medical scrubs online — tops, pants, and sets in durable poly-cotton fabric. DAAKYKA Apparels, Pan India.",
    h1: "Premium Medical Scrubs",
    intro:
      "DAAKYKA medical scrubs combine durable fabric with refined design — for doctors, nurses, technicians, and healthcare teams who demand more from their uniforms.",
    bullets: [
      "Shop tops, bottoms, and sets",
      "Tops and bottoms sold separately or as a set",
      "INR pricing with optional USD display",
      "Institutional and bulk order programs",
    ],
    faqs: [
      {
        question: "Are DAAKYKA scrubs suitable for hospital procurement?",
        answer: "Yes — we supply both individual retail orders and institutional programs with embroidery, color standards, and Pan India delivery.",
      },
    ],
    productCategory: "scrub-sets",
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
      "Personalized embroidered medical scrubs with name and logo options from DAAKYKA Apparels — Pan India delivery.",
    h1: "Custom Embroidered Scrubs",
    intro:
      "Add your name, credentials, or department logo to your scrubs with custom embroidery for individuals and institutional teams.",
    bullets: [
      "Name and title embroidery",
      "Hospital and department logo programs",
      "Bulk embroidery for institutional orders",
      "Premium thread colors to match brand guidelines",
    ],
    faqs: [
      {
        question: "Can I preview embroidery before ordering?",
        answer: "Share your name, title, or logo details with your order or bulk enquiry, and our team will confirm placement and thread colors before production.",
      },
    ],
    productCategory: "scrub-sets",
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
      "Relaxed, easy-movement fits for unrestricted movement",
      "Breathable poly-cotton fabric",
      "Reinforced seams for repeated hospital laundering",
      "Relaxed fits that maintain a professional silhouette",
    ],
    faqs: [
      {
        question: "What is the best scrub fit for active clinical roles?",
        answer: "Athletic-fit joggers paired with a relaxed top balance mobility with a clean, professional look.",
      },
      {
        question: "How should I care for performance scrubs?",
        answer: "Wash in cold water, avoid fabric softener, and tumble dry low to keep fabric and stitching in good condition.",
      },
    ],
    productCategory: "scrub-sets",
    shopHref: "/category/scrub-sets",
    shopLabel: "Shop Scrubs",
    secondaryHref: "/blog/how-to-choose-medical-scrubs",
    secondaryLabel: "Read Full Guide",
  },
  {
    slug: "doctor-scrubs",
    path: "/doctor-scrubs",
    title: "Doctor Scrubs",
    metaDescription:
      "Premium doctor scrubs with refined fits and durable poly-cotton fabric. Shop DAAKYKA Apparels — Pan India.",
    h1: "Doctor Scrubs",
    intro:
      "From rounds to procedures — doctor scrubs that balance authority, comfort, and durability for demanding clinical schedules.",
    bullets: [
      "Mandarin and V-neck styles for professional presentation",
      "Relaxed, easy-movement fits during procedures",
      "Durable poly-cotton 65/35 fabric",
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
    productCategory: "scrub-sets",
    shopHref: "/category/scrub-sets",
    shopLabel: "Shop Doctor Scrubs",
    secondaryHref: "/mandarin-collar-scrubs",
    secondaryLabel: "Mandarin Collar Styles",
  },
  {
    slug: "scrub-tops",
    path: "/scrub-tops",
    title: "Scrub Tops",
    metaDescription:
      "Medical scrub tops — V-neck, mandarin, and zip-neck styles in durable poly-cotton fabric. DAAKYKA Apparels.",
    h1: "Scrub Tops",
    intro:
      "The right scrub top sets the tone for your shift. Browse tops in breathable, durable fabric with a clean professional silhouette.",
    bullets: [
      "V-neck, mandarin collar, and zip-neck silhouettes",
      "Multiple pocket layouts for clinical essentials",
      "Pair with any of our scrub pants",
      "Embroidery for name and department branding",
    ],
    faqs: [
      {
        question: "How do I choose between V-neck and mandarin collar tops?",
        answer: "V-necks offer classic versatility; mandarin collars deliver a sharper, contemporary look favored in premium hospital settings.",
      },
    ],
    productCategory: "scrub-tops",
    shopHref: "/category/scrub-tops",
    shopLabel: "Shop Scrub Tops",
    secondaryHref: "/mix-and-match",
    secondaryLabel: "Build Your Set",
  },
  {
    slug: "scrub-pants",
    path: "/scrub-pants",
    title: "Scrub Pants",
    metaDescription:
      "Medical scrub pants and joggers with drawstring comfort and durable poly-cotton fabric. DAAKYKA Apparels.",
    h1: "Scrub Pants",
    intro:
      "From straight-leg classics to athletic joggers — scrub bottoms built for 12-hour shifts with secure pockets and easy care.",
    bullets: [
      "Jogger and straight-leg fits",
      "Drawstring and elastic waistbands for all-day comfort",
      "Reinforced seams for durability",
      "Pair with any of our scrub tops",
    ],
    faqs: [
      {
        question: "Jogger vs straight-leg scrub pants — which is better?",
        answer: "Joggers suit active clinical roles with tapered ankles; straight-leg pants offer a traditional fit preferred in many hospital dress codes.",
      },
    ],
    productCategory: "scrub-pants",
    shopHref: "/category/scrub-pants",
    shopLabel: "Shop Scrub Pants",
    secondaryHref: "/jogger-scrub-pants",
    secondaryLabel: "Explore Joggers",
  },
  {
    slug: "jogger-scrub-pants",
    path: "/jogger-scrub-pants",
    title: "Jogger Scrub Pants",
    metaDescription:
      "Athletic jogger scrub pants with a tapered fit and durable poly-cotton fabric. DAAKYKA Apparels — Pan India.",
    h1: "Jogger Scrub Pants",
    intro:
      "The modern scrub bottom — tapered joggers in durable fabric that move with you through rounds, procedures, and long shifts on your feet.",
    bullets: [
      "Tapered ankle for a clean, athletic silhouette",
      "Elastic cuffs and a drawstring waist for all-day comfort",
      "Secure zip or cargo pockets",
      "Available across men's and women's sizing",
    ],
    faqs: [
      {
        question: "Are jogger scrubs acceptable in hospitals?",
        answer: "Many modern hospitals accept jogger-style scrubs; confirm your institution's dress code — we offer both joggers and straight-leg options.",
      },
    ],
    productCategory: "scrub-pants",
    shopHref: "/category/scrub-pants",
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
      "Durable poly-cotton fabric with a tailored, tidy finish",
      "Ideal for leadership and specialist roles",
      "Custom embroidery available",
    ],
    faqs: [
      {
        question: "Who wears mandarin collar scrubs?",
        answer: "Doctors, department heads, and specialists often choose mandarin collars for a polished appearance that still meets clinical function requirements.",
      },
    ],
    // release-hardening audit F-003: /shop/bespoke has no real catalogue
    // behind it yet — /category/scrub-tops has this guide's actual products.
    productCategory: "scrub-tops",
    shopHref: "/category/scrub-tops",
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
    productCategory: "for-hospitals",
    shopHref: "/bulk-orders",
    shopLabel: "Request Bulk Quote",
    secondaryHref: "/for-hospitals",
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
      "Relaxed, easy-movement fits for procedure-room mobility",
      "Reinforced seams for repeated hospital laundering",
      "Embroidery for credentials and department identity",
    ],
    faqs: [
      {
        question: "What fabric is best for doctor scrubs?",
        answer: "A relaxed, breathable poly-cotton scrub offers a good balance of comfort and durability across long clinical shifts.",
      },
    ],
    productCategory: "scrub-sets",
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
      "Breathable poly-cotton fabric with reinforced seams",
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
    productCategory: "scrub-sets",
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
      "Ill-fitting scrubs distract from patient care. Use our sizing approach to match your measurements to the right top and bottom sizes — tops and bottoms are sold separately, so you can choose different sizes for each.",
    bullets: [
      "Measure chest, waist, and hip for accurate sizing",
      "Tops and bottoms can be different sizes",
      "Relaxed vs athletic fit guidance by role",
      "S through 2XL available across our scrub styles",
    ],
    faqs: [
      {
        question: "Should scrub tops and bottoms be the same size?",
        answer: "Not necessarily — many professionals wear a different top and bottom size. Scrub tops and pants are sold separately, so choose the size that fits each best.",
      },
      {
        question: "What if I'm between sizes?",
        answer: "For tops, size up if you layer under scrubs; for joggers, refer to waist measurement and preferred fit (relaxed vs tapered).",
      },
    ],
    productCategory: "scrub-sets",
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
      "Relaxed, easy-movement fits for active clinical roles",
      "Durable, easy-care poly-cotton fabric",
      "Tops and bottoms sold separately for a better fit",
      "Institutional programs for hospital teams",
    ],
    buyingGuide: [
      "Start with fit — a relaxed cut that doesn't restrict movement suits high-activity roles.",
      "Choose fit by role — relaxed tops with joggers for nurses; mandarin collars for doctors.",
      "Confirm pocket layout matches your clinical tool carry needs.",
      "Check care labels — poly-cotton scrubs need a cold wash and low-heat dry to last.",
    ],
    faqs: [
      {
        question: "What is the most important factor when choosing scrubs?",
        answer: "Fit and fabric — a relaxed, breathable poly-cotton cut has the biggest impact on comfort across a full shift.",
      },
      {
        question: "Should I buy scrub sets or mix tops and bottoms?",
        answer: "Tops and bottoms are sold separately as well as in sets, so you can choose different sizes and styles for each, which most professionals prefer.",
      },
    ],
    productCategory: "scrub-sets",
    shopHref: "/shop",
    shopLabel: "Shop Medical Scrubs",
    secondaryHref: "/blog/how-to-choose-medical-scrubs",
    secondaryLabel: "Read Full Article",
    relatedGuides: ["how-to-find-scrub-size", "best-scrubs-for-long-shifts", "medical-scrubs"],
    relatedBlogSlugs: ["how-to-choose-medical-scrubs"],
    relatedCollections: ["best-sellers"],
  },
  {
    slug: "how-to-wash-medical-scrubs",
    path: "/how-to-wash-medical-scrubs",
    title: "How to Wash Medical Scrubs",
    metaDescription:
      "Care guide for medical scrubs — wash and dry instructions to keep fabric and stitching in good condition. DAAKYKA Apparels.",
    h1: "How to Wash Medical Scrubs",
    intro:
      "Scrubs need the right wash routine to keep their fit, colour, and stitching in good condition shift after shift.",
    bullets: [
      "Cold water wash protects elastic fibers",
      "Skip fabric softener, which can coat fibres over time",
      "Low-heat tumble dry or air dry",
      "Wash after each clinical shift for hygiene",
    ],
    buyingGuide: [
      "Pre-treat stains promptly, and avoid harsh bleach, which weakens fabric over time.",
      "Turn garments inside out to protect surface prints and embroidery.",
      "Wash scrubs separately from heavily soiled laundry when possible.",
      "Hang or fold promptly to reduce wrinkles without high-heat ironing.",
    ],
    faqs: [
      {
        question: "Can I use fabric softener on scrub uniforms?",
        answer: "Avoid fabric softener on scrubs — it coats fibres and can make fabric feel less breathable over time.",
      },
      {
        question: "How often should medical scrubs be washed?",
        answer: "After every shift. Regular laundering is essential for hospital-grade hygiene.",
      },
    ],
    productCategory: "scrub-sets",
    shopHref: "/fabric-technology",
    shopLabel: "Explore Fabric Tech",
    secondaryHref: "/blog/caring-for-performance-scrubs",
    secondaryLabel: "Read Care Article",
    relatedGuides: ["best-scrubs-for-long-shifts", "what-is-4-way-stretch-fabric"],
    relatedBlogSlugs: ["caring-for-performance-scrubs"],
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
    productCategory: "scrub-sets",
    shopHref: "/doctor-scrubs",
    shopLabel: "Shop Doctor Scrubs",
    secondaryHref: "/for-hospitals",
    secondaryLabel: "Hospital Uniforms",
    relatedGuides: ["doctor-scrubs", "nurse-uniforms", "hospital-uniforms"],
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
    productCategory: "for-hospitals",
    shopHref: "/bulk-orders",
    shopLabel: "Request Bulk Quote",
    secondaryHref: "/blog/best-colors-for-hospital-uniforms",
    secondaryLabel: "Read Full Article",
    relatedGuides: ["hospital-uniforms", "bulk-hospital-uniforms", "nurse-uniforms"],
    relatedBlogSlugs: ["best-colors-for-hospital-uniforms"],
  },
  {
    slug: "what-is-4-way-stretch-fabric",
    path: "/what-is-4-way-stretch-fabric",
    title: "What Is 4-Way Stretch Fabric",
    metaDescription:
      "What is 4-way stretch fabric in medical scrubs — a plain-language definition, benefits, and care basics.",
    h1: "What Is 4-Way Stretch Fabric?",
    intro:
      "4-way stretch is a performance textile that expands and recovers both horizontally and vertically — a fabric technology worth understanding as clinical workwear evolves.",
    bullets: [
      "Stretches width-wise and length-wise for full mobility",
      "Maintains shape recovery after repeated wear",
      "Useful for bending, reaching, and long shifts",
      "One of several performance-fabric options in modern uniforms",
    ],
    buyingGuide: [
      "Look for stretch panels at the shoulders, elbows, and knees, where mobility matters most.",
      "Compare with 2-way stretch, which moves primarily in one direction, if you prefer a more structured drape.",
      "Whatever fabric you choose, follow the garment's care label to preserve shape over time.",
      "Prioritise fit and pocket layout alongside fabric — comfort during a shift depends on both.",
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
    productCategory: "scrub-sets",
    shopHref: "/category/scrub-sets",
    shopLabel: "Shop Scrub Sets",
    secondaryHref: "/how-to-choose-medical-scrubs",
    secondaryLabel: "How to Choose Scrubs",
    relatedGuides: ["best-scrubs-for-long-shifts", "jogger-scrub-pants", "how-to-wash-medical-scrubs"],
  },
];

// release-hardening audit F-020: `stretch-collection`, `hospital-teams` and
// `bespoke` used to live here too, each rendering nothing but a "Continue
// to X" interstitial with zero product cards (see
// src/app/collections/[handle]/page.tsx's `shopHref` branch) — every one
// of those three had real content elsewhere already (their own `shopHref`
// pointed at /fabric-technology/4-way-stretch, /for-hospitals and
// /shop/bespoke respectively), so the dead middle page added nothing.
// Their old /collections/<handle> URLs now redirect straight to those
// destinations instead (see next.config.ts's `redirects()`). "Best
// Sellers" is the only collection page left that actually needs its own
// page here, since it renders a real product grid.
export const collectionPages = [
  {
    handle: "best-sellers",
    title: "Featured",
    description: "A cross-section of what we're highlighting right now, across scrubs, school and kids wear.",
    shopQuery: { featured: "true" },
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
