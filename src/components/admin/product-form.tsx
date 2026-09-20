"use client";

import Link from "next/link";
import { cloneElement, useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { ProductVariantEditor, type VariantRow } from "@/components/admin/product-variant-editor";
import { ProductImageGallery, type ProductImageRow } from "@/components/admin/product-image-gallery";
import { StagedProductImageGallery } from "@/components/admin/staged-product-image-gallery";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { useUnsavedChangesGuard, useUnsavedChangesNav } from "@/components/admin/unsaved-changes";
import { slugify } from "@/lib/catalog/category-validation";
import { isDirty } from "@/lib/admin/is-dirty";
import { attachStagedImages } from "@/lib/admin/attach-staged-images";
import type { StagedImage } from "@/lib/admin/staged-images";
import { formatApiError } from "@/lib/validation/format-api-error";

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
  // F-04 (docs/audit-2026-09-19/admin-ux.md): images picked/generated
  // before the product itself has ever been saved — see
  // StagedProductImageGallery and attachStagedImages(). Always empty once
  // `productId` is set (edit mode, or right after a successful create),
  // since the real ProductImageGallery takes over at that point.
  const [stagedImages, setStagedImages] = useState<StagedImage[]>([]);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const flatCategories = useMemo(() => flattenCategories(categoryOptions), [categoryOptions]);
  const selectedCategory = categoryOptions.find((c) => c.id === categoryId);
  const productColors = useMemo(() => Array.from(new Set(variants.map((v) => v.color))), [variants]);
  const orderCount = initial?.orderCount ?? 0;
  const canDelete = isEdit && status === "DRAFT" && orderCount === 0;

  // F-13: unsaved-changes protection. `images` is deliberately excluded —
  // ProductImageGallery persists every add/reorder/delete immediately via
  // its own API calls (see product-image-gallery.tsx), so there's never
  // anything "unsaved" about it. `variants` is included: it's local state
  // bundled into the same POST/PATCH as the rest of the form by
  // saveVariantsIfChanged() below, not saved until then.
  function buildSnapshot() {
    return {
      name,
      slug,
      shortDescription,
      description,
      categoryId,
      status,
      featured,
      isNew,
      price,
      compareAtPrice,
      gender,
      fabric,
      care,
      tagsText,
      sizeChartId,
      seoTitle,
      seoDescription,
      variants,
    };
  }
  // Captured once, at mount, via the lazy useState() initializer (a plain
  // `useRef(buildSnapshot())` would read `.current` during render, which
  // this repo's react-hooks/refs lint rule rejects — see
  // src/lib/admin/is-dirty.ts) from the same state already initialized
  // from `initial`.
  const [initialSnapshot, setInitialSnapshot] = useState(buildSnapshot);
  // F-04: unlike `images` (see the comment above buildSnapshot), a staged
  // image is real, already-uploaded storage with nothing pointing to it
  // yet — leaving the form without saving is exactly the kind of loss this
  // guard exists for, so it counts as "dirty" even though it isn't part of
  // buildSnapshot()'s own JSON-comparable shape.
  const dirty = isDirty(buildSnapshot(), initialSnapshot) || stagedImages.length > 0;
  useUnsavedChangesGuard(dirty);
  const { confirmLeave } = useUnsavedChangesNav();

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
      setErrorMessage(formatApiError(body, "Couldn't save variants.").summary);
      return false;
    }
    return true;
  }

  async function saveDraft() {
    setSaveStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});
    setSaved(false);

    const payload = buildPayload();
    if (payload.compareAtPrice != null && payload.compareAtPrice <= payload.price) {
      setSaveStatus("error");
      setErrorMessage("Compare-at price must be greater than the price.");
      setFieldErrors({ compareAtPrice: "Compare-at price must be greater than the price." });
      return;
    }

    const response = await fetch(isEdit ? `/api/admin/products/${productId}` : "/api/admin/products", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // F-02: server validation failures (e.g. a negative price) used to
      // 400 with nothing shown anywhere on the page. formatApiError() maps
      // the Zod `issues` array the route returns (src/lib/catalog/products.ts's
      // productInputSchema/productUpdateSchema) into a readable summary
      // plus a per-field message, rather than dumping the raw `{error:
      // "Invalid request"}` boilerplate at the admin.
      const body = await response.json().catch(() => ({}));
      const { summary, fieldErrors: fe } = formatApiError(body, "Couldn't save — check the fields above.");
      setSaveStatus("error");
      setErrorMessage(summary);
      setFieldErrors(fe);
      return;
    }

    const body = await response.json();
    const savedId: string = body.product.id;
    setProductId(savedId);

    // F-04 (docs/audit-2026-09-19/admin-ux.md): the product now has a real
    // id for the first time, so this is where every staged image (already
    // uploaded/generated — see StagedProductImageGallery — just not yet
    // linked to a product) gets attached, via the same
    // POST /api/admin/products/[id]/images route the saved-product gallery
    // already uses. This is what turns "add a product with a photo" back
    // into a single pass instead of the old save → reload → scroll to
    // Images → upload two-round-trip flow.
    //
    // Only ever non-empty when `!isEdit`: an edit form starts with
    // `productId` already set, so StagedProductImageGallery never renders
    // and stagedImages never gets populated. Individual attach failures are
    // tolerated (attachStagedImages never throws) rather than blocking the
    // rest of the save — the product itself already saved successfully by
    // this point, and every staged image is a real, already-persisted
    // MediaAsset, so losing one photo must not cost the admin the whole
    // product. A failed one simply won't appear in the gallery; the
    // already-uploaded file isn't lost (it becomes an unattached MediaAsset
    // the admin can re-add, or that scripts/cleanup-orphaned-media.ts will
    // eventually sweep) — see that script's file comment for the full
    // orphan-lifecycle story. There's no in-UI warning for this specific
    // rare case: the very next thing that happens on success is a
    // navigation to the real edit page (see `router.push` below), which
    // unmounts this form before any message set here could ever be seen.
    if (!isEdit && stagedImages.length > 0) {
      const { attached } = await attachStagedImages(savedId, stagedImages, {
        attach: async (id, staged) => {
          const attachResponse = await fetch(`/api/admin/products/${id}/images`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mediaAssetId: staged.mediaAssetId, color: staged.color, alt: staged.alt || undefined }),
          });
          if (!attachResponse.ok) return null;
          const attachBody = await attachResponse.json();
          return {
            id: attachBody.image.id,
            mediaId: attachBody.image.mediaId,
            url: attachBody.image.media.url,
            alt: attachBody.image.alt,
            color: attachBody.image.color,
            sortOrder: attachBody.image.sortOrder,
          };
        },
      });
      setImages(attached);
      setStagedImages([]);
    }

    const variantsOk = await saveVariantsIfChanged(savedId);
    setSaveStatus(variantsOk ? "idle" : "error");

    if (variantsOk) {
      // F-13: this save just persisted exactly what's in the form, so it's
      // no longer "dirty" relative to it — updating the snapshot here
      // (rather than only at mount) means immediately navigating away
      // right after a successful save doesn't trigger the guard.
      setInitialSnapshot(buildSnapshot());
      // F-03/F-16: match the Orders page's own "Saved." confirmation
      // pattern (src/components/admin/order-detail-actions.tsx) instead of
      // leaving a save with no visible confirmation at all.
      setSaved(true);
    }

    if (!isEdit) {
      router.push(`/admin/products/${savedId}`);
    } else {
      router.refresh();
    }
  }

  async function runAction(action: string, run: () => Promise<Response>) {
    setBusyAction(action);
    setErrorMessage(null);
    setFieldErrors({});
    setSaved(false);
    const response = await run();
    setBusyAction(null);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const { summary, fieldErrors: fe } = formatApiError(body, `Couldn't ${action}.`);
      setErrorMessage(summary);
      setFieldErrors(fe);
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
      // Only fold `status` into the pristine snapshot — publish only
      // persists the status flip, not any other pending, unsaved field
      // edit, so this must not mark the rest of the form as "saved" too
      // (that would silently defeat the F-13 guard for those fields).
      setInitialSnapshot((prev) => ({ ...prev, status: "ACTIVE" }));
      setSaved(true);
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
      // See the comment in publish() above — only `status` was persisted.
      setInitialSnapshot((prev) => ({ ...prev, status: "DRAFT" }));
      setSaved(true);
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
      // See the comment in publish() above — only `status` was persisted.
      setInitialSnapshot((prev) => ({ ...prev, status: "ARCHIVED" }));
      setSaved(true);
      router.refresh();
    }
  }

  async function duplicate() {
    if (!productId) return;
    setBusyAction("duplicate");
    setErrorMessage(null);
    const response = await fetch(`/api/admin/products/${productId}/duplicate`, { method: "POST" });
    setBusyAction(null);
    if (response.ok) {
      const body = await response.json();
      router.push(`/admin/products/${body.product.id}`);
    } else {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(formatApiError(body, "Couldn't duplicate the product.").summary);
    }
  }

  async function remove() {
    if (!productId || !canDelete) return;
    if (!confirm("Delete this draft product permanently?")) return;
    setBusyAction("delete");
    const response = await fetch(`/api/admin/products/${productId}`, { method: "DELETE" });
    setBusyAction(null);
    if (response.ok) {
      setInitialSnapshot(buildSnapshot());
      router.push("/admin/products");
    } else {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(formatApiError(body, "Couldn't delete the product.").summary);
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Basics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={fieldErrors.name}>
            <input value={name} onChange={(e) => onNameChange(e.target.value)} className={inputClass} />
          </Field>
          <Field
            label="Slug"
            error={fieldErrors.slug}
            hint={slugStatus === "checking" ? "Checking…" : slugStatus === "taken" ? "Already in use" : slugStatus === "available" ? "Available" : "Lowercase letters, numbers, and hyphens"}
          >
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
        <Field label="Short description" error={fieldErrors.shortDescription}>
          <input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Description" error={fieldErrors.description}>
          <RichTextEditor editorKey={initial?.id ?? "new"} value={description} onChange={setDescription} />
        </Field>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-ink">Category</h2>
          <Link href="/admin/categories/new" target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand hover:underline">
            + New category
          </Link>
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-invalid={Boolean(fieldErrors.categoryId)}
          aria-describedby={fieldErrors.categoryId ? "product-category-error" : undefined}
          className={inputClass}
        >
          {flatCategories.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        {fieldErrors.categoryId ? (
          <p id="product-category-error" className="text-[11px] font-medium text-red-600">
            {fieldErrors.categoryId}
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Pricing</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price (INR)" error={fieldErrors.price}>
            <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value === "" ? "" : Number(e.target.value))} className={inputClass} />
          </Field>
          <Field label="Compare-at price" error={fieldErrors.compareAtPrice} hint="Must be greater than price to show a Sale badge">
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
          // F-04: images can now be selected/generated before the first
          // save — see StagedProductImageGallery and the attach step in
          // saveDraft() above.
          <StagedProductImageGallery
            images={stagedImages}
            productColors={productColors}
            aiFields={{ name, category: selectedCategory?.name, gender, fabric }}
            onChange={setStagedImages}
          />
        )}
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fabric" error={fieldErrors.fabric}>
            <input value={fabric} onChange={(e) => setFabric(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Care instructions" error={fieldErrors.care}>
            <input value={care} onChange={(e) => setCare(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Gender" error={fieldErrors.gender}>
            <select value={gender} onChange={(e) => setGender(e.target.value as Gender)} className={inputClass}>
              {genderValues.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Size chart" error={fieldErrors.sizeChartId} hint="Leave as None to inherit the category's default">
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
        <Field label="Tags" error={fieldErrors.tags} hint="Comma-separated">
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
        <Field label="SEO title" error={fieldErrors.seoTitle}>
          <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="SEO description" error={fieldErrors.seoDescription}>
          <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={2} className={inputClass} />
        </Field>
        <div className="rounded-xl border border-border bg-surface-muted p-3">
          <p className="truncate text-sm text-[#1a0dab]">{seoTitle || name || "Product title"}</p>
          <p className="text-xs text-[#006621]">daakyka.com › products › {slug || "product-slug"}</p>
          <p className="text-xs text-muted">{seoDescription || shortDescription || "A short description of the product will appear here."}</p>
        </div>
      </section>

      <FormErrorBanner message={errorMessage} />

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lg">
        <button type="button" onClick={saveDraft} disabled={saveStatus === "saving" || !name.trim() || !price} className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {saveStatus === "saving" ? "Saving…" : status === "DRAFT" ? "Save draft" : "Save changes"}
        </button>

        {saved && !errorMessage ? <span className="text-xs font-medium text-green-700">Saved.</span> : null}

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

        <button
          type="button"
          onClick={() => {
            // F-13: a plain router.push here would silently discard a
            // dirty form exactly like the reported bug — this is the same
            // confirmLeave() the sidebar's GuardedLink uses.
            if (!confirmLeave()) return;
            router.push("/admin/products");
          }}
          className="ml-auto rounded-full px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40"
        >
          Back to list
        </button>
      </div>
    </div>
  );
}

const inputClass = "w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand";

/**
 * Wraps a single form control with its label + (error or hint) text.
 * release-hardening a11y fix: the control now gets `aria-invalid` plus an
 * `aria-describedby` pointing at the error message's `id` whenever there
 * is one, so a screen reader announces the association — previously the
 * error text rendered inline with no programmatic link to its input.
 * Visual design is unchanged; only these two ARIA attributes are added to
 * whatever single element `children` already is.
 */
function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactElement }) {
  const errorId = useId();
  const control = cloneElement(children as ReactElement<Record<string, unknown>>, {
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? errorId : undefined,
  });
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {control}
      {error ? (
        <span id={errorId} className="mt-1 block text-[11px] font-medium text-red-600">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
