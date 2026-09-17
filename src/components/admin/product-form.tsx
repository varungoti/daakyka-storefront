"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductVariantEditor, type VariantRow } from "@/components/admin/product-variant-editor";
import { ProductImageGallery, type ProductImageRow } from "@/components/admin/product-image-gallery";
import { slugify } from "@/lib/catalog/category-validation";

const genderValues = ["MEN", "WOMEN", "UNISEX", "BOYS", "GIRLS", "KIDS"] as const;
type Gender = (typeof genderValues)[number];

export interface ProductCategoryOption {
  id: string;
  name: string;
  section: string;
  parentId: string | null;
}

export interface ProductSizeChartOption {
  id: string;
  name: string;
}

export interface ProductFormInitial {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  categoryId: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  featured: boolean;
  isNew: boolean;
  price: number;
  compareAtPrice: number | null;
  gender: Gender;
  fabric: string | null;
  care: string | null;
  tags: string[];
  sizeChartId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  variants: VariantRow[];
  images: ProductImageRow[];
  orderCount: number;
}

/** Flattens the category tree into a list with `depth` for indentation
 * (parents appear before their children, matching a natural tree read). */
function flattenCategories(options: ProductCategoryOption[]): { id: string; label: string; depth: number }[] {
  const byParent = new Map<string | null, ProductCategoryOption[]>();
  for (const option of options) {
    const list = byParent.get(option.parentId) ?? [];
    list.push(option);
    byParent.set(option.parentId, list);
  }
  const result: { id: string; label: string; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const option of byParent.get(parentId) ?? []) {
      result.push({ id: option.id, label: `${"— ".repeat(depth)}${option.name}`, depth });
      visit(option.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

export function ProductForm({
  initial,
  categoryOptions,
  sizeChartOptions,
  canPublish,
}: {
  initial?: ProductFormInitial;
  categoryOptions: ProductCategoryOption[];
  sizeChartOptions: ProductSizeChartOption[];
  canPublish: boolean;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);
  const [productId, setProductId] = useState<string | undefined>(initial?.id);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [shortDescription, setShortDescription] = useState(initial?.shortDescription ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? categoryOptions[0]?.id ?? "");
  const [status, setStatus] = useState(initial?.status ?? "DRAFT");
  const [featured, setFeatured] = useState(initial?.featured ?? false);
  const [isNew, setIsNew] = useState(initial?.isNew ?? false);
  const [price, setPrice] = useState<number | "">(initial?.price ?? "");
  const [compareAtPrice, setCompareAtPrice] = useState<number | "">(initial?.compareAtPrice ?? "");
  const [gender, setGender] = useState<Gender>(initial?.gender ?? "UNISEX");
  const [fabric, setFabric] = useState(initial?.fabric ?? "");
  const [care, setCare] = useState(initial?.care ?? "");
  const [tagsText, setTagsText] = useState((initial?.tags ?? []).join(", "));
  const [sizeChartId, setSizeChartId] = useState(initial?.sizeChartId ?? "");
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? "");
  const [variants, setVariants] = useState<VariantRow[]>(initial?.variants ?? []);
  const [images, setImages] = useState<ProductImageRow[]>(initial?.images ?? []);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const flatCategories = useMemo(() => flattenCategories(categoryOptions), [categoryOptions]);
  const selectedCategory = categoryOptions.find((c) => c.id === categoryId);
  const productColors = useMemo(() => Array.from(new Set(variants.map((v) => v.color))), [variants]);
  const orderCount = initial?.orderCount ?? 0;
  const canDelete = isEdit && status === "DRAFT" && orderCount === 0;

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  useEffect(() => {
    // The "checking"/"idle" indicator must update synchronously so the
    // debounced check below shows immediately, not after it resolves —
    // same documented data-fetching effect pattern as search-dialog.tsx.
    if (!slug.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlugStatus("idle");
      return;
    }
    setSlugStatus("checking");
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ slug: slugify(slug) });
        if (productId) params.set("excludeId", productId);
        const response = await fetch(`/api/admin/products/check-slug?${params}`);
        if (!response.ok) {
          setSlugStatus("idle");
          return;
        }
        const body = await response.json();
        setSlugStatus(body.available ? "available" : "taken");
      } catch {
        setSlugStatus("idle");
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [slug, productId]);

  function buildPayload() {
    return {
      name: name.trim(),
      slug: slug.trim() ? slugify(slug) : undefined,
      shortDescription: shortDescription.trim() || null,
      description: description.trim() || null,
      categoryId,
      status,
      featured,
      isNew,
      price: Number(price),
      compareAtPrice: compareAtPrice === "" ? null : Number(compareAtPrice),
      gender,
      fabric: fabric.trim() || null,
      care: care.trim() || null,
      tags: tagsText
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      sizeChartId: sizeChartId || null,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
    };
  }

  async function saveVariantsIfChanged(id: string) {
    if (variants.length === 0) return true;
    const response = await fetch(`/api/admin/products/${id}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variants: variants.map((v) => ({ size: v.size, color: v.color, colorHex: v.colorHex, sku: v.sku, price: v.price, stock: v.stock, active: v.active })) }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(body?.error ?? "Couldn't save variants.");
      return false;
    }
    return true;
  }

  async function saveDraft() {
    setSaveStatus("saving");
    setErrorMessage(null);

    const payload = buildPayload();
    if (payload.compareAtPrice != null && payload.compareAtPrice <= payload.price) {
      setSaveStatus("error");
      setErrorMessage("Compare-at price must be greater than the price.");
      return;
    }

    const response = await fetch(isEdit ? `/api/admin/products/${productId}` : "/api/admin/products", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setSaveStatus("error");
      setErrorMessage(body?.error ?? "Couldn't save — check the fields above.");
      return;
    }

    const body = await response.json();
    const savedId: string = body.product.id;
    setProductId(savedId);

    const variantsOk = await saveVariantsIfChanged(savedId);
    setSaveStatus(variantsOk ? "idle" : "error");

    if (!isEdit) {
      router.push(`/admin/products/${savedId}`);
    } else {
      router.refresh();
    }
  }

  async function runAction(action: string, run: () => Promise<Response>) {
    setBusyAction(action);
    setErrorMessage(null);
    const response = await run();
    setBusyAction(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(body?.error ?? `Couldn't ${action}.`);
      return false;
    }
    return true;
  }

  async function publish() {
    if (!productId) return;
    const ok = await runAction("publish", () =>
      fetch(`/api/admin/products/${productId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "publish" }) }),
    );
    if (ok) {
      setStatus("ACTIVE");
      router.refresh();
    }
  }

  async function unpublish() {
    if (!productId) return;
    const ok = await runAction("unpublish", () =>
      fetch(`/api/admin/products/${productId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unpublish" }) }),
    );
    if (ok) {
      setStatus("DRAFT");
      router.refresh();
    }
  }

  async function archive() {
    if (!productId) return;
    const ok = await runAction("archive", () =>
      fetch(`/api/admin/products/${productId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "archive" }) }),
    );
    if (ok) {
      setStatus("ARCHIVED");
      router.refresh();
    }
  }

  async function duplicate() {
    if (!productId) return;
    setBusyAction("duplicate");
    const response = await fetch(`/api/admin/products/${productId}/duplicate`, { method: "POST" });
    setBusyAction(null);
    if (response.ok) {
      const body = await response.json();
      router.push(`/admin/products/${body.product.id}`);
    } else {
      setErrorMessage("Couldn't duplicate the product.");
    }
  }

  async function remove() {
    if (!productId || !canDelete) return;
    if (!confirm("Delete this draft product permanently?")) return;
    setBusyAction("delete");
    const response = await fetch(`/api/admin/products/${productId}`, { method: "DELETE" });
    setBusyAction(null);
    if (response.ok) {
      router.push("/admin/products");
    } else {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(body?.error ?? "Couldn't delete the product.");
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Basics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input value={name} onChange={(e) => onNameChange(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Slug" hint={slugStatus === "checking" ? "Checking…" : slugStatus === "taken" ? "Already in use" : slugStatus === "available" ? "Available" : "Lowercase letters, numbers, and hyphens"}>
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Short description">
          <input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={inputClass} />
        </Field>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Category</h2>
          <Link href="/admin/categories/new" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand hover:underline">
            + New category
          </Link>
        </div>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
          {flatCategories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Pricing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price (INR)">
            <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label="Compare-at price" hint="Must be greater than price to show a Sale badge">
            <input
              type="number"
              min={0}
              step="0.01"
              value={compareAtPrice}
              onChange={(e) => setCompareAtPrice(e.target.value === "" ? "" : Number(e.target.value))}
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Variants</h2>
        <ProductVariantEditor categoryName={selectedCategory?.name ?? ""} productSlug={slug || slugify(name)} variants={variants} onChange={setVariants} />
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Images</h2>
        {productId ? (
          <ProductImageGallery
            productId={productId}
            images={images}
            productColors={productColors}
            aiFields={{ name, category: selectedCategory?.name, gender, fabric }}
            onChange={setImages}
          />
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted">Save the product as a draft first to add images.</p>
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fabric">
            <input value={fabric} onChange={(e) => setFabric(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Care instructions">
            <input value={care} onChange={(e) => setCare(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Gender">
            <select value={gender} onChange={(e) => setGender(e.target.value as Gender)} className={inputClass}>
              {genderValues.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Size chart" hint="Leave as None to inherit the category's default">
            <select value={sizeChartId} onChange={(e) => setSizeChartId(e.target.value)} className={inputClass}>
              <option value="">None — inherit from category</option>
              {sizeChartOptions.map((chart) => (
                <option key={chart.id} value={chart.id}>
                  {chart.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Tags" hint="Comma-separated">
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} className={inputClass} />
        </Field>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
            Featured
          </label>
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={isNew} onChange={(e) => setIsNew(e.target.checked)} />
            New arrival
          </label>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">SEO</h2>
        <Field label="SEO title">
          <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="SEO description">
          <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={2} className={inputClass} />
        </Field>
        <div className="rounded-xl border border-border bg-surface-muted p-3">
          <p className="truncate text-sm text-[#1a0dab]">{seoTitle || name || "Product title"}</p>
          <p className="text-xs text-[#006621]">daakyka.com › products › {slug || "product-slug"}</p>
          <p className="text-xs text-muted">{seoDescription || shortDescription || "A short description of the product will appear here."}</p>
        </div>
      </section>

      {errorMessage ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600">{errorMessage}</p> : null}

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lg">
        <button type="button" onClick={saveDraft} disabled={saveStatus === "saving" || !name.trim() || !price} className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {saveStatus === "saving" ? "Saving…" : "Save draft"}
        </button>

        <span title={canPublish ? "" : "Requires products:publish"}>
          {status === "ACTIVE" ? (
            <button type="button" onClick={unpublish} disabled={!canPublish || !productId || busyAction === "unpublish"} className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted disabled:cursor-not-allowed disabled:opacity-50">
              Unpublish
            </button>
          ) : (
            <button type="button" onClick={publish} disabled={!canPublish || !productId || busyAction === "publish"} className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              Publish
            </button>
          )}
        </span>

        {isEdit && (
          <button type="button" onClick={duplicate} disabled={busyAction === "duplicate"} className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40">
            Duplicate
          </button>
        )}

        {isEdit && status !== "ARCHIVED" && (
          <button type="button" onClick={archive} disabled={busyAction === "archive"} className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40">
            Archive
          </button>
        )}

        {isEdit && (
          <span title={canDelete ? "" : "Only draft products with no orders can be deleted"}>
            <button type="button" onClick={remove} disabled={!canDelete || busyAction === "delete"} className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
              Delete
            </button>
          </span>
        )}

        <button type="button" onClick={() => router.push("/admin/products")} className="ml-auto rounded-full px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40">
          Back to list
        </button>
      </div>
    </div>
  );
}

const inputClass = "w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}
