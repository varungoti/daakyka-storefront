"use client";

import "./globals.css";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" data-theme="light">
      <body className="flex min-h-screen items-center justify-center bg-background p-6 font-sans text-ink">
        <div className="max-w-md text-center">
          <h1 className="font-display text-2xl font-bold text-ink">DAAKYKA Apparels</h1>
          <p className="mt-4 text-sm text-muted">
            A critical error occurred. Please refresh the page or try again shortly.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
