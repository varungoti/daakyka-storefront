import { CheckCircle2, Circle, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderTimeline } from "@/lib/orders/timeline";

/**
 * Release-hardening item 2 — pure presentation over getOrderTimeline's
 * data (src/lib/orders/timeline.ts holds the actual status -> steps
 * logic, and is what timeline.test.ts exercises). No hooks/state, so
 * this renders fine straight from a Server Component.
 */
export function OrderTimelineView({ timeline }: { timeline: OrderTimeline }) {
  return (
    <div className="space-y-6">
      <ol>
        {timeline.steps.map((step, index) => (
          <li key={step.id} className="relative flex gap-4 pb-8 last:pb-0">
            {index < timeline.steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[11px] top-6 h-full w-0.5",
                  step.state === "complete" ? "bg-brand" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                step.state === "complete" && "bg-brand text-white",
                step.state === "current" && "border-2 border-brand bg-white text-brand",
                step.state === "upcoming" && "border-2 border-border bg-white",
              )}
            >
              {step.state === "complete" ? (
                <CheckCircle2 size={16} aria-hidden />
              ) : (
                <Circle size={8} fill="currentColor" className={step.state === "upcoming" ? "text-border" : ""} aria-hidden />
              )}
            </span>
            <div className="pt-0.5">
              <p className={cn("text-sm font-semibold", step.state === "upcoming" ? "text-muted" : "text-ink")}>
                {step.label}
              </p>
              {step.description && <p className="mt-1 text-sm text-muted">{step.description}</p>}
            </div>
          </li>
        ))}
      </ol>

      {timeline.terminal && (
        <div
          className={cn(
            "flex items-start gap-3 rounded-2xl border p-4 text-sm",
            timeline.terminal.tone === "cancelled"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          {timeline.terminal.tone === "cancelled" ? (
            <XCircle size={20} className="mt-0.5 shrink-0" aria-hidden />
          ) : (
            <RotateCcw size={20} className="mt-0.5 shrink-0" aria-hidden />
          )}
          <div>
            <p className="font-semibold">{timeline.terminal.label}</p>
            <p className="mt-1">{timeline.terminal.description}</p>
          </div>
        </div>
      )}
    </div>
  );
}
