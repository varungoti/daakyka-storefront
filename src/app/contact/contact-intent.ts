import { CONTACT_PAGE } from "@/lib/seo/static-pages";

/**
 * What /contact shows for the `?type=` and `?intent=` query params its inbound
 * links carry — the footer, bulk-order links and, most importantly, the
 * "Having trouble? Contact us" link under checkout's Place Order button and
 * the checkout error boundary (`/contact?intent=checkout`). Pure so the
 * wording and the preset enquiry type can be tested without rendering the page.
 */

export type ContactEnquiryType = "GENERAL" | "INSTITUTIONAL" | "BULK_ORDER" | "SUPPORT";

const TYPE_BY_PARAM: Record<string, ContactEnquiryType> = {
  general: "GENERAL",
  institutional: "INSTITUTIONAL",
  bulk: "BULK_ORDER",
  support: "SUPPORT",
};

export interface ContactIntentParams {
  intent?: string;
  type?: string;
}

export interface ContactIntent {
  /** The enquiry type the form opens on. */
  defaultType: ContactEnquiryType;
  /** True when the shopper arrived from checkout asking for help with an order. */
  isCheckoutHelp: boolean;
  heading: { title: string; description: string };
}

const GENERAL_HEADING = {
  title: CONTACT_PAGE.h1,
  description:
    "Questions about scrubs, hospital linens, school uniforms, or bulk institutional orders? Reach out to Babaji Enterprises.",
};

// F-154: this used to say "Checkout is being connected" — left over from before
// checkout existed, and a shopper stuck at the Place Order button read it as
// "checkout doesn't work". Checkout is live; this is a help page for someone
// who hit a problem with it.
const CHECKOUT_HELP_HEADING = {
  title: "Need Help With Your Order?",
  description:
    "Tell us what went wrong at checkout and our team will call or WhatsApp you back — your cart is saved on this device.",
};

export function resolveContactIntent(params: ContactIntentParams): ContactIntent {
  const isCheckoutHelp = params.intent === "checkout";
  // Own-property lookup: `?type=constructor` must not resolve to
  // Object.prototype's `constructor` function.
  const typeParam = params.type;
  const typeFromParam =
    typeParam !== undefined && Object.hasOwn(TYPE_BY_PARAM, typeParam) ? TYPE_BY_PARAM[typeParam] : undefined;
  // An explicit ?type= wins; otherwise checkout help opens on "Product Support"
  // (it is a support request, not a sales enquiry), everything else on General.
  const defaultType = typeFromParam ?? (isCheckoutHelp ? "SUPPORT" : "GENERAL");
  return {
    defaultType,
    isCheckoutHelp,
    heading: isCheckoutHelp ? CHECKOUT_HELP_HEADING : GENERAL_HEADING,
  };
}
