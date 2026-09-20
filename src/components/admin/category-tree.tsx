"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type HTMLAttributes } from "react";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Trash2 } from "lucide-react";
import type { AdminCategoryNode } from "@/lib/catalog/categories";
import { swapStepsForMove } from "@/lib/admin/reorder";
import { cn } from "@/lib/utils";

async function patchCategory(id: string, patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(`/api/admin/categories/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (response.ok) return { ok: true };
  const body = await response.json().catch(() => ({}));
  return { ok: false, error: body?.error ?? "Something went wrong" };
}

/** Single-step "swap with adjacent sibling" call — the same request both
 * the ▲▼ buttons and the drag-and-drop handler below issue, deliberately
 * *not* followed by a `router.refresh()` here so a multi-step drag can
 * await several of these in a row and refresh only once at the end. */
async function reorderStep(id: string, direction: "up" | "down"): Promise<boolean> {
  const response = await fetch(`/api/admin/categories/${id}/reorder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ direction }),
  });
  return response.ok;
}

function Row({
  node,
  depth,
  dragHandleProps,
  busy,
}: {
  node: AdminCategoryNode;
  depth: number;
  /** Spread onto the grip icon to make it (and only it) the drag source —
   * undefined when this row is mid-reorder and dragging is disabled. */
  dragHandleProps?: HTMLAttributes<HTMLSpanElement>;
  busy: boolean;
}) {
  const router = useRouter();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggle = async (field: "active" | "showInMenu") => {
    setErrorMessage(null);
    const result = await patchCategory(node.id, { [field]: !node[field] });
    if (result.ok) {
      router.refresh();
    } else {
      setErrorMessage(result.error ?? "Couldn't save — try again.");
    }
  };

  const move = async (direction: "up" | "down") => {
    setErrorMessage(null);
    const ok = await reorderStep(node.id, direction);
    if (ok) {
      router.refresh();
    } else {
      setErrorMessage("Couldn't reorder — try again.");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${node.name}"? This can't be undone.`)) return;
    setErrorMessage(null);
    const response = await fetch(`/api/admin/categories/${node.id}`, { method: "DELETE" });
    if (response.ok) {
      router.refresh();
    } else {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(body?.error ?? "Couldn't delete — try again.");
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3"
      style={{ marginLeft: depth * 24 }}
    >
      {/* F-06 (docs/audit-2026-09-19/admin-ux.md): drag handle — mouse/touch
          affordance only. The ▲▼ buttons below remain the fully
          keyboard-and-screen-reader-accessible way to reorder; this icon
          is decorative for those users (native HTML5 drag-and-drop has no
          keyboard equivalent of its own, which is exactly why the buttons
          are kept rather than replaced). */}
      <span
        aria-hidden="true"
        title="Drag to reorder"
        className={cn(
          "shrink-0 cursor-grab touch-none rounded-lg p-1 text-muted/60 hover:bg-lilac/40 hover:text-muted active:cursor-grabbing",
          busy && "pointer-events-none opacity-40",
        )}
        {...dragHandleProps}
      >
        <GripVertical size={16} />
      </span>

      <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-lavender/40">
        {node.image ? (
          <Image src={node.image.url} alt={node.image.alt ?? node.name} fill className="object-cover" sizes="40px" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-ink">{node.name}</p>
          <span className="text-xs text-muted">/{node.slug}</span>
          {!node.active && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">Inactive</span>
          )}
          {!node.showInMenu && (
            <span className="rounded-full bg-lavender/60 px-2 py-0.5 text-[11px] font-bold text-muted">
              Hidden from menu
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {node.productCount} product{node.productCount === 1 ? "" : "s"}
          {node.childCount > 0 ? ` · ${node.childCount} sub-categor${node.childCount === 1 ? "y" : "ies"}` : ""}
          {node.sizeChartName ? ` · Size chart: ${node.sizeChartName}` : ""}
        </p>
        {errorMessage ? <p className="mt-1 text-xs text-red-600">{errorMessage}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => move("up")}
          aria-label="Move up"
          className="rounded-lg p-1.5 text-muted hover:bg-lilac/40 hover:text-ink disabled:opacity-40"
        >
          <ChevronUp size={16} />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => move("down")}
          aria-label="Move down"
          className="rounded-lg p-1.5 text-muted hover:bg-lilac/40 hover:text-ink disabled:opacity-40"
        >
          <ChevronDown size={16} />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => toggle("active")}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-40",
            node.active ? "bg-trust/15 text-trust" : "bg-lavender/60 text-muted",
          )}
        >
          {node.active ? "Active" : "Inactive"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => toggle("showInMenu")}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-40",
            node.showInMenu ? "bg-brand/10 text-brand" : "bg-lavender/60 text-muted",
          )}
        >
          {node.showInMenu ? "In menu" : "Not in menu"}
        </button>
        <Link
          href={`/admin/categories/${node.id}`}
          aria-label="Edit"
          className="rounded-lg p-1.5 text-muted hover:bg-lilac/40 hover:text-ink"
        >
          <Pencil size={16} />
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          aria-label="Delete"
          className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

/** One level of siblings (same parentId) — owns the drag-and-drop state
 * for that level, since a drag is only ever meaningful within a single
 * parent's children (matching what the ▲▼ buttons already do). Renders
 * each node's own children as a nested `SiblingList`, recursively. */
function SiblingList({ nodes, depth }: { nodes: AdminCategoryNode[]; depth: number }) {
  const router = useRouter();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [reordering, setReordering] = useState(false);

  async function handleDrop(targetIndex: number) {
    const fromIndex = dragIndex;
    setDragIndex(null);
    setOverIndex(null);
    if (fromIndex === null || fromIndex === targetIndex) return;

    const steps = swapStepsForMove(fromIndex, targetIndex);
    const id = nodes[fromIndex].id;
    setReordering(true);
    // Sequential and awaited on purpose: each step re-reads the current
    // sortOrder server-side (see reorderCategory), so steps must land in
    // order rather than racing — see src/lib/admin/reorder.ts's doc
    // comment for why N single-step swaps are equivalent to one splice.
    for (const direction of steps) {
      const ok = await reorderStep(id, direction);
      if (!ok) break;
    }
    setReordering(false);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {nodes.map((node, index) => (
        <div
          key={node.id}
          onDragOver={(event) => {
            if (dragIndex === null) return;
            event.preventDefault();
            if (overIndex !== index) setOverIndex(index);
          }}
          onDrop={(event) => {
            event.preventDefault();
            void handleDrop(index);
          }}
          className={cn(
            "rounded-xl transition",
            overIndex === index && dragIndex !== null && dragIndex !== index && "outline outline-2 outline-offset-2 outline-brand",
          )}
        >
          <Row
            node={node}
            depth={depth}
            busy={reordering}
            dragHandleProps={{
              draggable: true,
              onDragStart: (event) => {
                setDragIndex(index);
                event.dataTransfer.effectAllowed = "move";
                // Firefox requires data to be set for a drag to start.
                event.dataTransfer.setData("text/plain", node.id);
              },
              onDragEnd: () => {
                setDragIndex(null);
                setOverIndex(null);
              },
            }}
          />
          {node.children.length > 0 && (
            <div className="mt-2">
              <SiblingList nodes={node.children} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function CategoryTree({ nodes }: { nodes: AdminCategoryNode[] }) {
  return <SiblingList nodes={nodes} depth={0} />;
}
