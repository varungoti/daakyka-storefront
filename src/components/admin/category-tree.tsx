"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import type { AdminCategoryNode } from "@/lib/catalog/categories";
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

function Row({ node, depth }: { node: AdminCategoryNode; depth: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const toggle = async (field: "active" | "showInMenu") => {
    setBusy(true);
    setErrorMessage(null);
    const result = await patchCategory(node.id, { [field]: !node[field] });
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setErrorMessage(result.error ?? "Couldn't save — try again.");
    }
  };

  const move = async (direction: "up" | "down") => {
    setBusy(true);
    setErrorMessage(null);
    const response = await fetch(`/api/admin/categories/${node.id}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction }),
    });
    setBusy(false);
    if (response.ok) {
      router.refresh();
    } else {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(body?.error ?? "Couldn't reorder — try again.");
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${node.name}"? This can't be undone.`)) return;
    setBusy(true);
    setErrorMessage(null);
    const response = await fetch(`/api/admin/categories/${node.id}`, { method: "DELETE" });
    setBusy(false);
    if (response.ok) {
      router.refresh();
    } else {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(body?.error ?? "Couldn't delete — try again.");
    }
  };

  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3"
        style={{ marginLeft: depth * 24 }}
      >
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

      {node.children.length > 0 && (
        <div className="mt-2 space-y-2">
          {node.children.map((child) => (
            <Row key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CategoryTree({ nodes }: { nodes: AdminCategoryNode[] }) {
  return (
    <div className="space-y-2">
      {nodes.map((node) => (
        <Row key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}
