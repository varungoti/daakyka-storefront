"use client";

import { Button, buttonClassNames } from "@/components/ui/button";
import { EMPTY_CART, setCartState } from "@/context/cart-store";
import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import { formatBasePrice } from "@/lib/currency/convert";
import { loadRazorpayCheckoutScript } from "@/lib/payments/load-razorpay-script";
import { isShopifyConfigured } from "@/lib/shopify/config";
import {
  INDIAN_PHONE_HINT,
  INDIAN_PINCODE_HINT,
  INDIAN_STATES,
  normalizeIndianPhone,
  normalizeIndianPincode,
} from "@/lib/validation/india";
import { AlertCircle, Lock, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";

/** F-134: a signed-in customer's saved address, as sent by
 * checkout/page.tsx's CheckoutSavedAddress — same shape, kept as a local
 * type since this is a client component. */
interface CheckoutSavedAddress {
  id: string;
  label: string | null;
  recipientName: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

interface CheckoutCustomerHint {
  email?: string;
  name?: string;
  /** F-134: the account holder's saved phone, prefilled the same way as
   * name/email — still just a display convenience, re-validated on
   * submit like everything else here. */
  phone?: string;
  /** F-134: default address first (checkout/page.tsx's own query orders
   * it that way) — used both to seed the form's initial state and to
   * populate the "Saved addresses" picker below. */
  addresses?: CheckoutSavedAddress[];
}

/** F-040: accepted so a caller (checkout/page.tsx today, the saved-address
 * wiring in a later pass) can seed the shipping-address fields for a
 * signed-in shopper. Purely a display prefill, same trust level as
 * `customerHint` — the server independently re-validates everything on
 * submit regardless of what these fields hold. */
interface CheckoutAddressPrefill {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

interface CheckoutShippingSettings {
  flatRate: number;
  freeAbove: number;
}

interface CheckoutApiSuccess {
  orderNumber: string;
  /** Guest-access token for the confirmation page (src/lib/orders/access-token.ts) — must
   * be carried through every redirect to /order/[number]; see get-order.ts. */
  orderToken: string;
  fallback?: boolean;
  razorpayOrderId?: string;
  keyId?: string;
  amount?: number;
  currency?: string;
}

function orderConfirmationPath(orderNumber: string, orderToken: string): string {
  return `/order/${encodeURIComponent(orderNumber)}?token=${encodeURIComponent(orderToken)}`;
}

interface CheckoutApiError {
  error: string;
  issues?: Array<{ path: (string | number)[]; message: string }>;
  field?: string;
  /** Carried on a 409 (out of stock) / 400 (no longer available) response
   * — see src/app/api/checkout/route.ts — so the offending Order Summary
   * line can be flagged instead of just showing a banner (F-034). */
  variantId?: string;
  /** F-121: real current stock, carried on a 409 so the flagged line can
   * offer "Update qty to N" instead of only Remove. */
  available?: number;
}

interface CheckoutFieldErrors {
  phone?: string;
  pincode?: string;
}

interface AppliedDiscount {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  amount: number;
}

interface DiscountPreviewResponse {
  code: string;
  type: "PERCENTAGE" | "FIXED";
  value: number;
  amount: number;
  subtotal: number;
}

/** F-115/F-116: the response shape of the side-effect-free POST
 * /api/checkout/quote — see that route for what it does and why. */
interface CheckoutQuoteLine {
  variantId: string;
  unitPrice: number;
  quantity: number;
}

interface CheckoutQuote {
  lines: CheckoutQuoteLine[];
  subtotal: number;
  shipping: number;
  freeAbove: number;
  total: number;
}

interface CheckoutQuoteError {
  error: string;
  variantId?: string;
  /** F-121: see CheckoutApiError.available's doc comment. */
  available?: number;
}

function clearLocalCart(): void {
  setCartState({ cart: EMPTY_CART, cartId: "" });
}

/**
 * F-124: every retry of Place Order used to POST /api/checkout again,
 * minting a brand new Order + Razorpay order while the previous one stayed
 * payable — so a shopper whose first UPI collect completed late (after a
 * dismissed/failed retry) could end up with two paid orders. This keeps
 * the last Razorpay order this exact cart/details produced in
 * sessionStorage so a retry reopens the *same* order instead of creating
 * another one. It is display/UX only: server-side dedup of the actual
 * charge is out of scope here (see the order-lifecycle package this wave).
 */
const PENDING_RAZORPAY_ORDER_KEY = "daakyka-checkout-pending-razorpay-order";
// Comfortably under the 30-minute window the stale-order cron
// (src/app/api/cron/cancel-stale-orders/route.ts) uses to auto-cancel an
// untouched PENDING_PAYMENT order.
const PENDING_ORDER_MAX_AGE_MS = 25 * 60 * 1000;

interface PendingRazorpayOrder {
  orderNumber: string;
  orderToken: string;
  razorpayOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  signature: string;
  createdAt: number;
}

function isPendingRazorpayOrder(value: unknown): value is PendingRazorpayOrder {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.orderNumber === "string" &&
    typeof v.orderToken === "string" &&
    typeof v.razorpayOrderId === "string" &&
    typeof v.keyId === "string" &&
    typeof v.amount === "number" &&
    typeof v.currency === "string" &&
    typeof v.signature === "string" &&
    typeof v.createdAt === "number"
  );
}

function readPendingRazorpayOrder(): PendingRazorpayOrder | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_RAZORPAY_ORDER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingRazorpayOrder(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function savePendingRazorpayOrder(order: PendingRazorpayOrder): void {
  try {
    window.sessionStorage.setItem(PENDING_RAZORPAY_ORDER_KEY, JSON.stringify(order));
  } catch {
    // Best-effort only — worst case a retry creates a fresh order, same as
    // before this guard existed.
  }
}

function clearPendingRazorpayOrder(): void {
  try {
    window.sessionStorage.removeItem(PENDING_RAZORPAY_ORDER_KEY);
  } catch {
    // Ignore — nothing left to clean up.
  }
}

export function CheckoutPageContent({
  customerHint = {},
  prefillAddress,
  shipping,
}: {
  customerHint?: CheckoutCustomerHint;
  prefillAddress?: CheckoutAddressPrefill;
  shipping?: CheckoutShippingSettings;
}) {
  const { cart, mode, updateQuantity, removeLine } = useCart();
  const { formatPrice, currency } = useCurrency();
  const router = useRouter();
  const shopifyReady = isShopifyConfigured();

  // F-134: default address first (see checkout/page.tsx's query), used to
  // seed the form below and to offer the rest in a picker.
  const savedAddresses = customerHint.addresses ?? [];
  const defaultAddress = savedAddresses.find((address) => address.isDefault) ?? savedAddresses[0];

  const [name, setName] = useState(defaultAddress?.recipientName ?? customerHint.name ?? "");
  const [email, setEmail] = useState(customerHint.email ?? "");
  const [phone, setPhone] = useState(defaultAddress?.phone ?? customerHint.phone ?? "");
  const [line1, setLine1] = useState(defaultAddress?.line1 ?? prefillAddress?.line1 ?? "");
  const [line2, setLine2] = useState(defaultAddress?.line2 ?? prefillAddress?.line2 ?? "");
  const [city, setCity] = useState(defaultAddress?.city ?? prefillAddress?.city ?? "");
  const [stateName, setStateName] = useState(defaultAddress?.state ?? prefillAddress?.state ?? "");
  const [pincode, setPincode] = useState(defaultAddress?.pincode ?? prefillAddress?.pincode ?? "");
  const [country] = useState("IN");
  const [selectedAddressId, setSelectedAddressId] = useState(defaultAddress?.id ?? "new");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorNonce, setErrorNonce] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<CheckoutFieldErrors>({});
  const [problemVariantId, setProblemVariantId] = useState<string | null>(null);
  // F-121: real current stock for problemVariantId, when the block is
  // "still exists but not enough stock" rather than "gone entirely" — lets
  // the flagged Order Summary line offer "Update qty to N", not just
  // Remove.
  const [problemAvailable, setProblemAvailable] = useState<number | null>(null);

  // F-134: switching the picker seeds every address field from the chosen
  // saved address (or clears them for "Enter a new address"). Plain
  // setters, not a single "address" object, because that's how every
  // field below is already wired — keeps this consistent with manual
  // edits to the same fields.
  function handleAddressSelect(addressId: string) {
    setSelectedAddressId(addressId);
    if (addressId === "new") {
      setLine1("");
      setLine2("");
      setCity("");
      setStateName("");
      setPincode("");
      return;
    }
    const address = savedAddresses.find((candidate) => candidate.id === addressId);
    if (!address) return;
    if (address.recipientName) setName(address.recipientName);
    if (address.phone) setPhone(address.phone);
    setLine1(address.line1);
    setLine2(address.line2 ?? "");
    setCity(address.city);
    setStateName(address.state);
    setPincode(address.pincode);
    setFieldErrors({});
  }

  // F-034: the error banner and the phone/pincode fields render far above
  // the fold on mobile — nothing moved focus or scrolled it into view, so
  // "Place Order" looked like it silently did nothing. errorNonce (bumped
  // on every showError call, even for a repeated identical message) drives
  // the scroll/focus effect below. When showError is given a specific
  // field ref (a phone/pincode validation error), that field is focused
  // instead of the banner — it sits right beside the banner in the layout,
  // and focusing the field (rather than the banner) is what actually lets
  // a screen reader announce that field's aria-describedby hint. Keeping
  // this decision in one effect (rather than a second, independent
  // requestAnimationFrame call next to each showError) avoids the two
  // racing to be the last to call .focus().
  const errorRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const pincodeRef = useRef<HTMLInputElement>(null);
  const errorFocusTargetRef = useRef<RefObject<HTMLInputElement | null> | null>(null);

  function showError(message: string, focusOn?: RefObject<HTMLInputElement | null>) {
    errorFocusTargetRef.current = focusOn ?? null;
    setError(message);
    setErrorNonce((n) => n + 1);
  }

  useEffect(() => {
    if (errorNonce === 0) return;
    const target = errorFocusTargetRef.current?.current;
    if (target) {
      target.focus();
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    errorRef.current?.focus({ preventScroll: true });
    errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [errorNonce]);

  // Release-hardening F7: "Have a discount code?" — appliedDiscount is a
  // live preview only (POST /api/checkout/discount), never authoritative.
  // The final POST /api/checkout submission re-validates and re-computes
  // the discount from scratch server-side; nothing here is ever trusted as
  // the actual amount charged.
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null);
  const [discountApplying, setDiscountApplying] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);

  // F-115/F-116: a truthful, server-computed Shipping/Total (instead of
  // "calculated at the next step") and a live per-line price check
  // (instead of the price frozen in the cart at add-to-cart time). This is
  // a display-only refresh — POST /api/checkout still re-prices and
  // re-validates everything from scratch, same as before this existed.
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteUnavailableVariantId, setQuoteUnavailableVariantId] = useState<string | null>(null);
  // F-121: see problemAvailable's doc comment — same idea, for the
  // background quote check rather than a submit attempt.
  const [quoteUnavailableAvailable, setQuoteUnavailableAvailable] = useState<number | null>(null);
  const cartItemsKey = cart.lines.map((line) => `${line.variantId}:${line.quantity}`).sort().join("|");

  useEffect(() => {
    // Nothing to price, and the component renders the "cart is empty"
    // screen below instead of the summary in this case anyway — no state
    // to reset here, it just wouldn't be read.
    if (cart.lines.length === 0) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = (await response.json()) as CheckoutQuote | CheckoutQuoteError;
          if (!response.ok || "error" in data) {
            setQuote(null);
            setQuoteUnavailableVariantId("variantId" in data ? (data.variantId ?? null) : null);
            setQuoteUnavailableAvailable(
              "available" in data && typeof data.available === "number" ? data.available : null,
            );
            return;
          }
          setQuote(data);
          setQuoteUnavailableVariantId(null);
          setQuoteUnavailableAvailable(null);
        })
        .catch(() => {
          // Network hiccup, or the endpoint is rate-limited — this is a
          // display-only refresh, so keep whatever is already shown
          // (the cart's own figures, or the previous quote) rather than
          // blocking checkout over it.
        });
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartItemsKey]);

  if (mode === "shopify" && shopifyReady) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">Checkout via Shopify</h1>
        <p className="mt-2 text-muted">
          Use the cart&rsquo;s checkout button — it takes you to our secure Shopify checkout.
        </p>
        <Link href="/shop" className={buttonClassNames({ className: "mt-6" })}>
          Back to Shop
        </Link>
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <ShoppingBag className="mx-auto mb-4 text-muted" size={48} />
        <h1 className="font-display text-2xl font-bold text-ink">Your cart is empty</h1>
        <Link href="/shop" className={buttonClassNames({ className: "mt-6" })}>
          Continue Shopping
        </Link>
      </div>
    );
  }

  // F-287: checkout always shows and charges INR regardless of the
  // header's display-currency toggle — show that INR figure as the
  // primary amount everywhere in the summary, with the toggled currency
  // only as a secondary approximation, so a USD-display shopper isn't
  // placing an order having only ever seen a dollar figure.
  function renderInrPrice(amountInInr: number) {
    return (
      <>
        {formatBasePrice(amountInInr, "INR")}
        {currency === "USD" && (
          <span className="ml-1.5 text-xs font-normal text-muted">(≈ {formatPrice(amountInInr)})</span>
        )}
      </>
    );
  }

  const displaySubtotal = quote?.subtotal ?? cart.subtotal;
  const shippingFreeAbove = shipping?.freeAbove ?? quote?.freeAbove ?? Infinity;
  const displayShipping = quote
    ? quote.shipping
    : shipping
      ? (displaySubtotal >= shipping.freeAbove ? 0 : shipping.flatRate)
      : null;
  const discountAmount = appliedDiscount?.amount ?? 0;
  const baseTotal = quote ? quote.total : displayShipping !== null ? displaySubtotal + displayShipping : null;
  const displayTotal = baseTotal !== null ? Math.max(0, baseTotal - discountAmount) : null;

  async function verifyPaymentWithRetries(payload: {
    orderNumber: string;
    orderToken: string;
    razorpayPaymentId: string | undefined;
    razorpayOrderId: string | undefined;
    razorpaySignature: string | undefined;
  }): Promise<boolean> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const verifyRes = await fetch("/api/checkout/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const verifyData = (await verifyRes.json().catch(() => null)) as { ok?: boolean } | null;
        if (verifyRes.ok && verifyData?.ok) return true;
      } catch {
        // Network error — fall through and retry below.
      }
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 800));
      }
    }
    return false;
  }

  async function openRazorpayCheckout(details: {
    orderNumber: string;
    orderToken: string;
    razorpayOrderId: string;
    keyId: string;
    amount: number;
    currency: string;
  }) {
    await loadRazorpayCheckoutScript();
    if (!window.Razorpay) {
      showError("Payment could not be started. Please try again.");
      setSubmitting(false);
      return;
    }

    const { orderNumber, orderToken, razorpayOrderId, keyId, amount, currency: payCurrency } = details;
    const razorpay = new window.Razorpay({
      key: keyId,
      amount,
      currency: payCurrency,
      order_id: razorpayOrderId,
      name: "DAAKYKA Apparels",
      description: `Order ${orderNumber}`,
      prefill: { name, email, contact: phone },
      notes: { orderNumber },
      handler: async (response: unknown) => {
        const paymentResponse = response as {
          razorpay_payment_id?: string;
          razorpay_order_id?: string;
          razorpay_signature?: string;
        };
        // F-281: once Razorpay has called this handler, the payment has
        // already gone through from the shopper's point of view. Never
        // hand them back an editable checkout with the cart still full
        // and Place Order re-enabled — that's how a paid customer ends up
        // paying twice. Verify is idempotent (route.ts's PAID fast path),
        // so a couple of retries here are safe, and if it still can't be
        // confirmed we still leave (the webhook reconciles independently).
        const verified = await verifyPaymentWithRetries({
          orderNumber,
          orderToken,
          razorpayPaymentId: paymentResponse.razorpay_payment_id,
          razorpayOrderId: paymentResponse.razorpay_order_id,
          razorpaySignature: paymentResponse.razorpay_signature,
        });
        clearPendingRazorpayOrder();
        clearLocalCart();
        if (verified) {
          router.push(orderConfirmationPath(orderNumber, orderToken));
        } else {
          router.push(`${orderConfirmationPath(orderNumber, orderToken)}&payment=confirming`);
        }
      },
      modal: {
        ondismiss: () => {
          // Genuinely not charged — keep the pending order so a retry
          // reuses this same Razorpay order (F-124) instead of minting a
          // new one, and leave the cart alone.
          showError("Payment was cancelled. Your cart is unchanged — you can try again.");
          setSubmitting(false);
        },
      },
    });

    razorpay.on("payment.failed", () => {
      showError("Payment failed. Your cart is unchanged — you can try again.");
      setSubmitting(false);
    });

    razorpay.open();
  }

  function buildCheckoutSignature(): string {
    const items = [...cart.lines].map((line) => `${line.variantId}:${line.quantity}`).sort().join(",");
    return JSON.stringify([
      items,
      email.trim().toLowerCase(),
      phone.trim(),
      line1.trim(),
      line2.trim(),
      city.trim(),
      stateName.trim(),
      pincode.trim(),
      appliedDiscount?.code ?? "",
    ]);
  }

  async function handleApplyDiscount() {
    const code = discountCodeInput.trim();
    if (!code) return;

    setDiscountApplying(true);
    setDiscountError(null);

    try {
      const response = await fetch("/api/checkout/discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
          code,
          email: email || undefined,
        }),
      });
      const data = (await response.json()) as DiscountPreviewResponse | { error: string };

      if (!response.ok || "error" in data) {
        setAppliedDiscount(null);
        setDiscountError("error" in data ? data.error : "Could not apply this code. Please try again.");
        return;
      }

      setAppliedDiscount({ code: data.code, type: data.type, value: data.value, amount: data.amount });
    } catch {
      setAppliedDiscount(null);
      setDiscountError("Could not apply this code. Please check your connection and try again.");
    } finally {
      setDiscountApplying(false);
    }
  }

  function handleRemoveDiscount() {
    setAppliedDiscount(null);
    setDiscountCodeInput("");
    setDiscountError(null);
  }

  function handleDiscountInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // F-117: Enter/Go in this field sits inside the checkout <form> and
    // was submitting (and placing) the whole order at full price instead
    // of applying the code.
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!discountApplying && discountCodeInput.trim()) void handleApplyDiscount();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setProblemVariantId(null);
    setProblemAvailable(null);

    // Client-side format check first, so a bad phone/pincode gets an
    // immediate, specific inline message next to the field instead of a
    // round trip (the server — src/lib/validation/schemas.ts — re-checks
    // and normalises the same way regardless, since this check alone can
    // always be bypassed by calling the API directly).
    const normalizedPhone = normalizeIndianPhone(phone);
    const normalizedPincode = normalizeIndianPincode(pincode);
    const nextFieldErrors: CheckoutFieldErrors = {};
    if (!normalizedPhone) nextFieldErrors.phone = INDIAN_PHONE_HINT;
    if (!normalizedPincode) nextFieldErrors.pincode = INDIAN_PINCODE_HINT;
    if (nextFieldErrors.phone || nextFieldErrors.pincode) {
      setFieldErrors(nextFieldErrors);
      showError("Please fix the highlighted field(s) below.", nextFieldErrors.phone ? phoneRef : pincodeRef);
      return;
    }

    // F-117: a code typed but never applied must not silently ride along
    // as "no discount" — block the submit rather than placing a
    // full-price order the shopper didn't intend.
    if (discountCodeInput.trim() && !appliedDiscount) {
      setDiscountError("Tap Apply to use this code, or clear the field to continue.");
      showError("Your discount code hasn't been applied yet.");
      return;
    }

    setSubmitting(true);

    // F-124: reuse a still-payable Razorpay order from an earlier attempt
    // on this exact same cart and details, instead of minting a new order
    // (and a new Razorpay order) on every retry.
    const signature = buildCheckoutSignature();
    const pending = readPendingRazorpayOrder();
    if (pending) {
      if (pending.signature === signature && Date.now() - pending.createdAt < PENDING_ORDER_MAX_AGE_MS) {
        await openRazorpayCheckout(pending);
        return;
      }
      // Stale, or for a different cart/details — don't carry it forward.
      clearPendingRazorpayOrder();
    }

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
          email,
          phone: normalizedPhone,
          shippingAddress: {
            name,
            line1,
            line2: line2 || undefined,
            city,
            state: stateName,
            pincode: normalizedPincode,
            country,
          },
          discountCode: appliedDiscount?.code,
        }),
      });

      const data = (await response.json()) as CheckoutApiSuccess | CheckoutApiError;

      if (!response.ok || "error" in data) {
        let focusTarget: RefObject<HTMLInputElement | null> | undefined;
        if ("issues" in data && data.issues) {
          const mapped: CheckoutFieldErrors = {};
          for (const issue of data.issues) {
            const path = issue.path.join(".");
            if (path === "phone") mapped.phone = issue.message;
            if (path === "shippingAddress.pincode") mapped.pincode = issue.message;
          }
          if (Object.keys(mapped).length > 0) {
            setFieldErrors(mapped);
            focusTarget = mapped.phone ? phoneRef : pincodeRef;
          }
        }
        // The discount was valid when previewed but the server rejected it
        // at the authoritative final check (e.g. its usage cap filled up in
        // the meantime) — surface that inline next to the field, same as a
        // phone/pincode issue, and drop the stale preview so the summary
        // stops showing a discount that was never actually applied.
        if ("field" in data && data.field === "discountCode") {
          setAppliedDiscount(null);
          setDiscountError(data.error);
        }
        // F-034: a 409 (out of stock) / 400 (no longer available) carries
        // the offending variantId — flag that Order Summary line instead
        // of leaving the shopper to guess which item the banner means.
        if ("variantId" in data && data.variantId) {
          setProblemVariantId(data.variantId);
          setProblemAvailable("available" in data && typeof data.available === "number" ? data.available : null);
        }
        showError("error" in data ? data.error : "Could not process checkout. Please try again.", focusTarget);
        setSubmitting(false);
        return;
      }

      if (data.fallback) {
        clearPendingRazorpayOrder();
        clearLocalCart();
        router.push(orderConfirmationPath(data.orderNumber, data.orderToken));
        return;
      }

      if (!data.razorpayOrderId || !data.keyId || !data.amount || !data.currency) {
        showError("Payment could not be started. Please try again.");
        setSubmitting(false);
        return;
      }

      savePendingRazorpayOrder({
        orderNumber: data.orderNumber,
        orderToken: data.orderToken,
        razorpayOrderId: data.razorpayOrderId,
        keyId: data.keyId,
        amount: data.amount,
        currency: data.currency,
        signature,
        createdAt: Date.now(),
      });

      await openRazorpayCheckout({
        orderNumber: data.orderNumber,
        orderToken: data.orderToken,
        razorpayOrderId: data.razorpayOrderId,
        keyId: data.keyId,
        amount: data.amount,
        currency: data.currency,
      });
    } catch {
      showError("Could not process checkout. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 lg:px-8">
      <h1 className="font-display text-3xl font-bold text-ink">Checkout</h1>
      <p className="mt-2 text-muted">Enter your details to complete your order.</p>

      {error && (
        <div
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="mt-6 flex scroll-mt-24 items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 outline-none"
        >
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-6">
          <fieldset className="space-y-4 rounded-2xl border border-border bg-surface p-4">
            <legend className="px-1 font-display text-lg font-bold text-ink">Contact</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-muted">
                Full name
                <input
                  required
                  id="checkout-name"
                  name="name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted">
                Phone
                <input
                  required
                  ref={phoneRef}
                  id="checkout-phone"
                  name="tel"
                  type="tel"
                  autoComplete="tel"
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.phone)}
                  aria-describedby={fieldErrors.phone ? "checkout-phone-error" : undefined}
                  className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-ink ${
                    fieldErrors.phone ? "border-red-400" : "border-border"
                  }`}
                />
                {fieldErrors.phone && (
                  <span id="checkout-phone-error" className="mt-1 block text-xs font-normal text-red-600">
                    {fieldErrors.phone}
                  </span>
                )}
              </label>
              <label className="text-sm text-muted sm:col-span-2">
                Email
                <input
                  required
                  id="checkout-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-border bg-surface p-4">
            <legend className="px-1 font-display text-lg font-bold text-ink">Shipping address</legend>
            {/* F-134: a signed-in customer's saved addresses used to be
                completely unused at checkout — this lets one be picked
                straight into the fields below, which stay the source of
                truth the server validates on submit either way. */}
            {savedAddresses.length > 1 && (
              <label className="block text-sm text-muted">
                Saved addresses
                <select
                  value={selectedAddressId}
                  onChange={(e) => handleAddressSelect(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                >
                  {savedAddresses.map((address) => (
                    <option key={address.id} value={address.id}>
                      {[address.label, address.isDefault ? "Default" : null].filter(Boolean).join(" — ") ||
                        `${address.line1}, ${address.city}`}
                    </option>
                  ))}
                  <option value="new">Enter a new address</option>
                </select>
              </label>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-muted sm:col-span-2">
                Address line 1
                <input
                  required
                  id="checkout-line1"
                  name="address-line1"
                  autoComplete="address-line1"
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted sm:col-span-2">
                Address line 2 (optional)
                <input
                  id="checkout-line2"
                  name="address-line2"
                  autoComplete="address-line2"
                  value={line2}
                  onChange={(e) => setLine2(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted">
                City
                <input
                  required
                  id="checkout-city"
                  name="address-level2"
                  autoComplete="address-level2"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted">
                State
                <select
                  required
                  id="checkout-state"
                  name="address-level1"
                  autoComplete="address-level1"
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                >
                  <option value="" disabled>
                    Select state
                  </option>
                  {INDIAN_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-muted">
                Pincode
                <input
                  required
                  ref={pincodeRef}
                  id="checkout-pincode"
                  name="postal-code"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={pincode}
                  onChange={(e) => {
                    setPincode(e.target.value);
                    if (fieldErrors.pincode) setFieldErrors((prev) => ({ ...prev, pincode: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.pincode)}
                  aria-describedby={fieldErrors.pincode ? "checkout-pincode-error" : undefined}
                  className={`mt-1 w-full rounded-md border bg-white px-3 py-2 text-ink ${
                    fieldErrors.pincode ? "border-red-400" : "border-border"
                  }`}
                />
                {fieldErrors.pincode && (
                  <span id="checkout-pincode-error" className="mt-1 block text-xs font-normal text-red-600">
                    {fieldErrors.pincode}
                  </span>
                )}
              </label>
              <label className="text-sm text-muted">
                Country
                <input
                  disabled
                  autoComplete="country-name"
                  value="India"
                  className="mt-1 w-full rounded-md border border-border bg-lilac/20 px-3 py-2 text-ink"
                />
              </label>
            </div>
          </fieldset>

          <h2 className="font-display text-lg font-bold text-ink">Order Summary</h2>
          {cart.lines.map((line) => {
            const isBlocked = problemVariantId === line.variantId || quoteUnavailableVariantId === line.variantId;
            // F-121: whichever check flagged this line (a failed submit
            // wins over the background quote, since it's the more recent,
            // authoritative one) — used to offer "Update qty to N" instead
            // of only Remove when the item still exists but is short on
            // stock.
            const blockedAvailable =
              problemVariantId === line.variantId ? problemAvailable : quoteUnavailableAvailable;
            const quotedLine = quote?.lines.find((q) => q.variantId === line.variantId);
            const unitPrice = quotedLine?.unitPrice ?? line.price;
            const priceChanged = quotedLine !== undefined && quotedLine.unitPrice !== line.price;

            function clearBlock() {
              if (problemVariantId === line.variantId) {
                setProblemVariantId(null);
                setProblemAvailable(null);
              }
              if (quoteUnavailableVariantId === line.variantId) {
                setQuoteUnavailableVariantId(null);
                setQuoteUnavailableAvailable(null);
              }
            }

            return (
              <article
                key={line.id}
                className={`flex gap-4 rounded-2xl border p-4 ${
                  isBlocked ? "border-red-400 bg-red-50" : "border-border bg-surface"
                }`}
              >
                <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-lilac/30">
                  <Image src={line.image} alt={line.productTitle} fill className="object-cover" sizes="64px" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-ink">{line.productTitle}</p>
                  <p className="text-sm text-muted">{line.variantTitle} × {line.quantity}</p>
                  <p className="mt-1 font-semibold">{renderInrPrice(unitPrice * line.quantity)}</p>
                  {priceChanged && (
                    <p className="mt-1 text-xs font-medium text-amber-600">
                      Price updated to {renderInrPrice(unitPrice * line.quantity)} (was{" "}
                      {renderInrPrice(line.price * line.quantity)})
                    </p>
                  )}
                  {isBlocked && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-red-600">
                      <span>
                        {blockedAvailable === null
                          ? "No longer available"
                          : `Only ${blockedAvailable} left`}
                      </span>
                      {blockedAvailable !== null && blockedAvailable > 0 && (
                        <button
                          type="button"
                          className="underline underline-offset-2"
                          onClick={() => {
                            updateQuantity(line.id, blockedAvailable);
                            clearBlock();
                          }}
                        >
                          Update qty to {blockedAvailable}
                        </button>
                      )}
                      <button
                        type="button"
                        className="underline underline-offset-2"
                        onClick={() => {
                          removeLine(line.id);
                          clearBlock();
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        <aside className="h-fit rounded-3xl border border-border bg-surface-elevated p-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Subtotal</span>
            <span className="font-semibold text-ink">{renderInrPrice(displaySubtotal)}</span>
          </div>

          {appliedDiscount && (
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted">Discount ({appliedDiscount.code})</span>
              <span className="font-semibold text-trust-ink">-{renderInrPrice(appliedDiscount.amount)}</span>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between text-sm">
            <span className="text-muted">Shipping</span>
            <span className="font-semibold text-ink">
              {displayShipping === null ? "Calculating…" : displayShipping === 0 ? "Free" : renderInrPrice(displayShipping)}
            </span>
          </div>

          {displayShipping !== null && displayShipping > 0 && Number.isFinite(shippingFreeAbove) && (
            <p className="mt-1 text-xs text-muted">
              Add {renderInrPrice(Math.max(0, shippingFreeAbove - displaySubtotal))} more for free shipping.
            </p>
          )}

          {currency === "USD" && (
            <p className="mt-2 text-xs text-muted">
              You&rsquo;ll be charged in Indian Rupees (INR) — USD figures above are an approximate conversion.
            </p>
          )}

          {quoteUnavailableVariantId && (
            <p className="mt-2 text-xs font-medium text-red-600">
              An item in your cart is no longer available at this quantity. Please update your cart before
              continuing.
            </p>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
            <span className="font-display text-lg font-bold text-ink">Total</span>
            <span className="font-display text-2xl font-bold text-ink">
              {displayTotal === null ? "Calculating…" : renderInrPrice(displayTotal)}
            </span>
          </div>
          {/* F-125 */}
          <p className="mt-1 text-right text-xs text-muted">Inclusive of all taxes</p>

          <div className="mt-4 border-t border-border pt-4">
            {appliedDiscount ? (
              <div className="flex items-center justify-between gap-2 rounded-md bg-trust/10 px-3 py-2 text-sm text-trust-ink">
                <span>
                  Code <span className="font-semibold">{appliedDiscount.code}</span> applied
                </span>
                <button
                  type="button"
                  onClick={handleRemoveDiscount}
                  className="text-xs font-semibold underline underline-offset-2 hover:no-underline"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="text-sm text-muted">
                Have a discount code?
                <div className="mt-1 flex gap-2">
                  <input
                    autoComplete="off"
                    enterKeyHint="done"
                    value={discountCodeInput}
                    onChange={(e) => {
                      setDiscountCodeInput(e.target.value);
                      if (discountError) setDiscountError(null);
                    }}
                    onKeyDown={handleDiscountInputKeyDown}
                    placeholder="Enter code"
                    aria-invalid={Boolean(discountError)}
                    aria-describedby={discountError ? "checkout-discount-error" : undefined}
                    className={`w-full rounded-md border bg-white px-3 py-2 text-ink ${
                      discountError ? "border-red-400" : "border-border"
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleApplyDiscount}
                    disabled={discountApplying || !discountCodeInput.trim()}
                    className="shrink-0 rounded-md border border-ink px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {discountApplying ? "Applying…" : "Apply"}
                  </button>
                </div>
                {discountError && (
                  <span id="checkout-discount-error" className="mt-1 block text-xs font-normal text-red-600">
                    {discountError}
                  </span>
                )}
              </label>
            )}
          </div>

          <Button
            type="submit"
            className="mt-6 w-full"
            size="lg"
            disabled={submitting || Boolean(quoteUnavailableVariantId)}
          >
            <Lock size={18} />
            {submitting
              ? "Processing…"
              : displayTotal === null
                ? "Place Order"
                : `Place Order · ${formatBasePrice(displayTotal, "INR")}`}
          </Button>

          {/* F-149: checkout used to link to no policy at all — the only
              way to reach Terms/Refund/Privacy was the footer, which isn't
              rendered on this page's own scroll position. Opens in a new
              tab so a shopper reading a policy doesn't lose this form. */}
          <p className="mt-4 text-center text-xs text-muted">
            By placing this order you agree to our{" "}
            <Link href="/terms" target="_blank" rel="noopener" className="text-brand underline underline-offset-2">
              Terms
            </Link>
            ,{" "}
            <Link href="/returns" target="_blank" rel="noopener" className="text-brand underline underline-offset-2">
              Refund &amp; Cancellation Policy
            </Link>{" "}
            and{" "}
            <Link href="/privacy-policy" target="_blank" rel="noopener" className="text-brand underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>

          <p className="mt-2 text-center text-xs text-muted">
            Having trouble?{" "}
            <Link href="/contact?intent=checkout" className="text-brand underline underline-offset-2">
              Contact us
            </Link>{" "}
            with your cart details.
          </p>
        </aside>
      </form>
    </div>
  );
}
