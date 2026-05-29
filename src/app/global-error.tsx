"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-white p-6 font-sans text-gray-900">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">DAAKYKA Apparels</h1>
          <p className="mt-4 text-sm text-gray-600">
            A critical error occurred. Please refresh the page or try again shortly.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-full bg-violet-700 px-6 py-3 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
