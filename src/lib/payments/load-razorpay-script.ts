const RAZORPAY_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open(): void;
      on(event: string, handler: (response: unknown) => void): void;
    };
  }
}

let loadPromise: Promise<void> | null = null;

/**
 * Loads Razorpay's Checkout.js exactly once per page, appending a single
 * `<script>` tag (see next.config.ts CSP `script-src` for the allowlisted
 * https://checkout.razorpay.com host). Safe to call from multiple submit
 * handlers — later calls reuse the same in-flight/resolved promise instead
 * of injecting the script again.
 */
export function loadRazorpayCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("loadRazorpayCheckoutScript can only run in the browser"));
  }
  if (window.Razorpay) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Razorpay checkout script")));
      return;
    }

    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay checkout script"));
    document.body.appendChild(script);
  }).catch((error) => {
    loadPromise = null;
    throw error;
  });

  return loadPromise;
}
