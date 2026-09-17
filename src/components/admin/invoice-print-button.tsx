"use client";

export function InvoicePrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white"
    >
      Print
    </button>
  );
}
