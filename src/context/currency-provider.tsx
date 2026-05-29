"use client";

import {
  DEFAULT_CURRENCY,
  FREE_SHIPPING_THRESHOLD_INR,
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
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "daakyka-currency";

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

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<SupportedCurrency>(DEFAULT_CURRENCY);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as SupportedCurrency | null;
    if (stored === "INR" || stored === "USD") {
      setCurrencyState(stored);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_KEY, currency);
  }, [currency, mounted]);

  const setCurrency = useCallback((next: SupportedCurrency) => {
    setCurrencyState(next);
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrencyState((current) => (current === "INR" ? "USD" : "INR"));
  }, []);

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
    () => formatFreeShippingThreshold(currency, FREE_SHIPPING_THRESHOLD_INR),
    [currency],
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
