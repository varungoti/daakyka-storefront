"use client";

import { Button } from "@/components/ui/button";
import { EMPTY_CART, setCartState } from "@/context/cart-store";
import { useCart } from "@/context/cart-provider";
import { useCurrency } from "@/context/currency-provider";
import { loadRazorpayCheckoutScript } from "@/lib/payments/load-razorpay-script";
import { isShopifyConfigured } from "@/lib/shopify/config";
import { INDIAN_PHONE_HINT, INDIAN_PINCODE_HINT, normalizeIndianPhone, normalizeIndianPincode } from "@/lib/validation/india";
import { AlertCircle, Lock, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface CheckoutCustomerHint {
  email?: string;
  name?: string;
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

function clearLocalCart(): void {
  setCartState({ cart: EMPTY_CART, cartId: "" });
}

export function CheckoutPageContent({ customerHint = {} }: { customerHint?: CheckoutCustomerHint }) {
  const { cart, mode } = useCart();
  const { formatPrice } = useCurrency();
  const router = useRouter();
  const shopifyReady = isShopifyConfigured();

  const [name, setName] = useState(customerHint.name ?? "");
  const [email, setEmail] = useState(customerHint.email ?? "");
  const [phone, setPhone] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [country] = useState("IN");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<CheckoutFieldErrors>({});

  // Release-hardening F7: "Have a discount code?" — appliedDiscount is a
  // live preview only (POST /api/checkout/discount), never authoritative.
  // The final POST /api/checkout submission re-validates and re-computes
  // the discount from scratch server-side; nothing here is ever trusted as
  // the actual amount charged.
  const [discountCodeInput, setDiscountCodeInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null);
  const [discountApplying, setDiscountApplying] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);

  if (mode === "shopify" && shopifyReady) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="font-display text-2xl font-bold text-ink">Checkout via Shopify</h1>
        <p className="mt-2 text-muted">
          Use the cart&rsquo;s checkout button — it takes you to our secure Shopify checkout.
        </p>
        <Link href="/shop" className="mt-6 inline-block">
          <Button>Back to Shop</Button>
        </Link>
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <ShoppingBag className="mx-auto mb-4 text-muted" size={48} />
        <h1 className="font-display text-2xl font-bold text-ink">Your cart is empty</h1>
        <Link href="/shop" className="mt-6 inline-block">
          <Button>Continue Shopping</Button>
        </Link>
      </div>
    );
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

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
      setError("Please fix the highlighted field(s) below.");
      return;
    }

    setSubmitting(true);

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
        if ("issues" in data && data.issues) {
          const mapped: CheckoutFieldErrors = {};
          for (const issue of data.issues) {
            const path = issue.path.join(".");
            if (path === "phone") mapped.phone = issue.message;
            if (path === "shippingAddress.pincode") mapped.pincode = issue.message;
          }
          if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
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
        setError("error" in data ? data.error : "Could not process checkout. Please try again.");
        setSubmitting(false);
        return;
      }

      if (data.fallback) {
        clearLocalCart();
        router.push(orderConfirmationPath(data.orderNumber, data.orderToken));
        return;
      }

      if (!data.razorpayOrderId || !data.keyId || !data.amount || !data.currency) {
        setError("Payment could not be started. Please try again.");
        setSubmitting(false);
        return;
      }

      await loadRazorpayCheckoutScript();
      if (!window.Razorpay) {
        setError("Payment could not be started. Please try again.");
        setSubmitting(false);
        return;
      }

      const orderNumber = data.orderNumber;
      const orderToken = data.orderToken;
      const razorpay = new window.Razorpay({
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        order_id: data.razorpayOrderId,
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
          try {
            const verifyRes = await fetch("/api/checkout/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderNumber,
                orderToken,
                razorpayPaymentId: paymentResponse.razorpay_payment_id,
                razorpayOrderId: paymentResponse.razorpay_order_id,
                razorpaySignature: paymentResponse.razorpay_signature,
              }),
            });
            const verifyData = (await verifyRes.json()) as { ok?: boolean; error?: string };
            if (!verifyRes.ok || !verifyData.ok) {
              setError(verifyData.error ?? "Payment verification failed. Please contact us with your order number.");
              setSubmitting(false);
              return;
            }
            clearLocalCart();
            router.push(orderConfirmationPath(orderNumber, orderToken));
          } catch {
            setError("Payment verification failed. Please contact us with your order number.");
            setSubmitting(false);
          }
        },
        modal: {
          ondismiss: () => {
            setError("Payment was cancelled. Your cart is unchanged — you can try again.");
            setSubmitting(false);
          },
        },
      });

      razorpay.on("payment.failed", () => {
        setError("Payment failed. Your cart is unchanged — you can try again.");
        setSubmitting(false);
      });

      razorpay.open();
    } catch {
      setError("Could not process checkout. Please check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 lg:px-8">
      <h1 className="font-display text-3xl font-bold text-ink">Checkout</h1>
      <p className="mt-2 text-muted">Enter your details to complete your order.</p>

      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted">
                Phone
                <input
                  required
                  type="tel"
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
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-border bg-surface p-4">
            <legend className="px-1 font-display text-lg font-bold text-ink">Shipping address</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-muted sm:col-span-2">
                Address line 1
                <input
                  required
                  value={line1}
                  onChange={(e) => setLine1(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted sm:col-span-2">
                Address line 2 (optional)
                <input
                  value={line2}
                  onChange={(e) => setLine2(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted">
                City
                <input
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted">
                State
                <input
                  required
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-ink"
                />
              </label>
              <label className="text-sm text-muted">
                Pincode
                <input
                  required
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
                  value="India"
                  className="mt-1 w-full rounded-md border border-border bg-lilac/20 px-3 py-2 text-ink"
                />
              </label>
            </div>
          </fieldset>

          <h2 className="font-display text-lg font-bold text-ink">Order Summary</h2>
          {cart.lines.map((line) => (
            <article
              key={line.id}
              className="flex gap-4 rounded-2xl border border-border bg-surface p-4"
            >
              <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-lilac/30">
                <Image src={line.image} alt={line.productTitle} fill className="object-cover" sizes="64px" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-ink">{line.productTitle}</p>
                <p className="text-sm text-muted">{line.variantTitle} × {line.quantity}</p>
                <p className="mt-1 font-semibold">{formatPrice(line.price * line.quantity)}</p>
              </div>
            </article>
          ))}
        </section>

        <aside className="h-fit rounded-3xl border border-border bg-surface-elevated p-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Subtotal</span>
            <span className="font-display text-2xl font-bold text-ink">{formatPrice(cart.subtotal)}</span>
          </div>

          {appliedDiscount && (
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-muted">Discount ({appliedDiscount.code})</span>
              <span className="font-semibold text-trust">-{formatPrice(appliedDiscount.amount)}</span>
            </div>
          )}

          <p className="mt-2 text-xs text-muted">Shipping is calculated at the next step.</p>

          <div className="mt-4 border-t border-border pt-4">
            {appliedDiscount ? (
              <div className="flex items-center justify-between gap-2 rounded-md bg-trust/10 px-3 py-2 text-sm text-trust">
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
                    value={discountCodeInput}
                    onChange={(e) => {
                      setDiscountCodeInput(e.target.value);
                      if (discountError) setDiscountError(null);
                    }}
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

          <Button type="submit" className="mt-6 w-full" size="lg" disabled={submitting}>
            <Lock size={18} />
            {submitting ? "Processing…" : "Place Order"}
          </Button>

          <p className="mt-4 text-center text-xs text-muted">
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
