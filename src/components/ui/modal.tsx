"use client";

import { useFocusTrap } from "@/hooks/use-focus-trap";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Overrides the dialog's max-width class (default `max-w-2xl`) — e.g.
   * the admin media library browser (release-hardening F-07) wants more
   * horizontal room for a thumbnail grid than the size-guide table this
   * component was originally built for. */
  widthClassName?: string;
}

/**
 * Phase C5: a minimal shared dialog for the size-guide modal (no
 * existing modal component was found in components/ui — search covered
 * admin's size-chart preview too, which renders inline rather than as a
 * dialog). Mirrors ImageLightbox's pattern: mounted conditionally by the
 * parent, reuses useFocusTrap from C2 for focus containment,
 * Escape-to-close and body scroll lock.
 */
export function Modal({ title, onClose, children, widthClassName = "max-w-2xl" }: ModalProps) {
  const containerRef = useFocusTrap<HTMLDivElement>(true, onClose, { lockScroll: true });

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-ink/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl outline-none",
          widthClassName,
        )}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 transition hover:bg-lilac/50"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
