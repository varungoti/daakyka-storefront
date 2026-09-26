"use client";

import {
  DEFAULT_CURRENCY,
  SupportedCurrency,
} from "@/lib/currency/config";
import {
  convertFromBase,
  convertToBase,
  formatBasePrice,
  formatFreeShippingThreshold,
} from "@/lib/currency/convert";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "daakyka-currency";
const CURRENCY_CHANGE_EVENT = "daakyka-currency-change";

interface CurrencyContextValue {
  currency: SupportedCurrency;
  setCurrency: (currency: SupportedCurrency) => void;
  toggleCurrency: () => void;
  /** Format a price stored in INR */
  formatPrice: (amountInInr: number) => string;
  /** Convert INR base price to display currency numeric value */
  convertPrice: (amountInInr: number) => number;
  /** Convert display currency filter value to INR for filtering */
  toBasePrice: (displayAmount: number) => number;
  freeShippingLabel: string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

// Mirrors the theme provider's approach: the server always renders
// DEFAULT_CURRENCY, so useSyncExternalStore reconciles that with
// whatever is actually in localStorage on the client's first render,
// instead of rendering the default then flipping state in an effect
// (which would cost every price on the page an extra render, and can
// still show DEFAULT_CURRENCY-formatted prices flash-then-correct).
function readStoredCurrency(): SupportedCurrency {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "INR" || stored === "USD" ? stored : DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

function getServerCurrency(): SupportedCurrency {
  return DEFAULT_CURRENCY;
}

function subscribeToCurrencyChanges(onStoreChange: () => void) {
  window.addEventListener(CURRENCY_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(CURRENCY_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

export function CurrencyProvider({
  children,
  // F-008 fix: this used to be the hard-coded FREE_SHIPPING_THRESHOLD_INR
  // constant (₹8,299), which drifted from the admin-editable
  // `shipping.freeAbove` setting checkout and the PDP actually charge
  // against (₹8,000 by default). The root layout now fetches that setting
  // and passes it down here, so the trust bar, and anything else that
  // reads `freeShippingLabel`, always shows the real threshold — including
  // after an admin changes it in Site Controls (getSetting is cached under
  // SETTINGS_CACHE_TAG, which saving a setting already revalidates).
  freeShippingThresholdInr,
}: {
  children: ReactNode;
  freeShippingThresholdInr: number;
}) {
  const currency = useSyncExternalStore(
    subscribeToCurrencyChanges,
    readStoredCurrency,
    getServerCurrency,
  );

  const setCurrency = useCallback((next: SupportedCurrency) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore write failures (private browsing, quota); the change
      // still applies for the rest of this page view via the event.
    }
    window.dispatchEvent(new Event(CURRENCY_CHANGE_EVENT));
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrency(currency === "INR" ? "USD" : "INR");
  }, [currency, setCurrency]);

  const formatPrice = useCallback(
    (amountInInr: number) => formatBasePrice(amountInInr, currency),
    [currency],
  );

  const convertPrice = useCallback(
    (amountInInr: number) => convertFromBase(amountInInr, currency),
    [currency],
  );

  const toBasePrice = useCallback(
    (displayAmount: number) => convertToBase(displayAmount, currency),
    [currency],
  );

  const freeShippingLabel = useMemo(
    () => formatFreeShippingThreshold(currency, freeShippingThresholdInr),
    [currency, freeShippingThresholdInr],
  );

  const value = useMemo(
    () => ({
      currency,
      setCurrency,
      toggleCurrency,
      formatPrice,
      convertPrice,
      toBasePrice,
      freeShippingLabel,
    }),
    [currency, formatPrice, convertPrice, toBasePrice, freeShippingLabel, setCurrency, toggleCurrency],
  );

  return (
    <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error("useCurrency must be used within CurrencyProvider");
  }
  return context;
}
