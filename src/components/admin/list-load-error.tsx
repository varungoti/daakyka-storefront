export function ListLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 p-4 text-sm">
      <p role="alert" className="text-red-700">{message}</p>
      <button type="button" onClick={onRetry} className="font-semibold text-brand hover:underline">
        Try again
      </button>
    </div>
  );
}
