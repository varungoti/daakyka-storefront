"use client";

import Link from "next/link";
import { cloneElement, useEffect, useId, useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { ProductVariantEditor, getVariantGridError, type VariantRow } from "@/components/admin/product-variant-editor";
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
  countryOfOrigin: string | null;
  netQuantity: string | null;
  hsnCode: string | null;
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
  const [countryOfOrigin, setCountryOfOrigin] = useState(initial?.countryOfOrigin ?? "");
  const [netQuantity, setNetQuantity] = useState(initial?.netQuantity ?? "");
  const [hsnCode, setHsnCode] = useState(initial?.hsnCode ?? "");
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
  // F-065: below md the sticky bar keeps only Save + the listing switch and
  // tucks the rest behind a "More" menu, so it no longer covers a quarter
  // of a phone screen.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuId = useId();
  const duplicateHintId = useId();
  const deleteHintId = useId();

  const flatCategories = useMemo(() => flattenCategories(categoryOptions), [categoryOptions]);
  const selectedCategory = categoryOptions.find((c) => c.id === categoryId);
  const productColors = useMemo(() => Array.from(new Set(variants.map((v) => v.color))), [variants]);
  const productSizes = useMemo(() => Array.from(new Set(variants.filter((v) => v.active).map((v) => v.size))), [variants]);
  // F-179: same check ProductVariantEditor already renders inline below the
  // grid — reused here (not duplicated) to also disable Save, so a
  // duplicate/invalid grid can't reach the server at all.
  const variantGridError = useMemo(() => (variants.length > 0 ? getVariantGridError(variants) : null), [variants]);
  const orderCount = initial?.orderCount ?? 0;
  // F-185: an ARCHIVED product with no orders is deletable too, matching
  // deleteProduct's own rule — previously only DRAFT was, so the only UI
  // path to delete an archived product was Publish -> Unpublish -> Delete.
  const canDelete = isEdit && (status === "DRAFT" || status === "ARCHIVED") && orderCount === 0;

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
      countryOfOrigin,
      netQuantity,
      hsnCode,
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

  // F-336 ("diff-based buildPayload()"): on an edit, only include a field
  // whose current value actually differs from what this form loaded —
  // never re-send a field the admin didn't touch. Two admins editing the
  // same product at once used to clobber each other even on unrelated
  // fields, because every save PATCHed the *entire* form: A's price edit
  // silently vanished under B's save of an unrelated field, because B's
  // stale, page-load-time price rode along and overwrote it. `status` is
  // never sent at all — see the F-063 note above the Publish/Unpublish
  // buttons; those, not this payload, are the only path that changes it.
  // A create has nothing loaded to diff against, so it always sends
  // everything.
  function buildPayload() {
    const current = buildSnapshot();
    const fields: [keyof ReturnType<typeof buildSnapshot>, string, unknown][] = [
      ["name", "name", name.trim()],
      ["slug", "slug", slug.trim() ? slugify(slug) : undefined],
      ["shortDescription", "shortDescription", shortDescription.trim() || null],
      ["description", "description", description.trim() || null],
      ["categoryId", "categoryId", categoryId],
      ["featured", "featured", featured],
      ["isNew", "isNew", isNew],
      ["price", "price", Number(price)],
      ["compareAtPrice", "compareAtPrice", compareAtPrice === "" ? null : Number(compareAtPrice)],
      ["gender", "gender", gender],
      ["fabric", "fabric", fabric.trim() || null],
      ["care", "care", care.trim() || null],
      ["countryOfOrigin", "countryOfOrigin", countryOfOrigin.trim() || null],
      ["netQuantity", "netQuantity", netQuantity.trim() || null],
      ["hsnCode", "hsnCode", hsnCode.trim() || null],
      ["tagsText", "tags", tagsText.split(",").map((t) => t.trim()).filter(Boolean)],
      ["sizeChartId", "sizeChartId", sizeChartId || null],
      ["seoTitle", "seoTitle", seoTitle.trim() || null],
      ["seoDescription", "seoDescription", seoDescription.trim() || null],
    ];

    const payload: Record<string, unknown> = {};
    for (const [snapshotKey, payloadKey, value] of fields) {
      if (!isEdit || isDirty(current[snapshotKey], initialSnapshot[snapshotKey])) {
        payload[payloadKey] = value;
      }
    }
    return payload as {
      name?: string;
      slug?: string;
      shortDescription?: string | null;
      description?: string | null;
      categoryId?: string;
      featured?: boolean;
      isNew?: boolean;
      price?: number;
      compareAtPrice?: number | null;
      gender?: typeof gender;
      fabric?: string | null;
      care?: string | null;
      countryOfOrigin?: string | null;
      netQuantity?: string | null;
      hsnCode?: string | null;
      tags?: string[];
      sizeChartId?: string | null;
      seoTitle?: string | null;
      seoDescription?: string | null;
    };
  }

  // F-023/F-336 (P0 anchor): only call the variants endpoint when the
  // variant grid actually differs from what this form loaded or last
  // synced — comparing the grid alone, not the whole form snapshot,
  // matters here: unrelated field edits (e.g. the short description) must
  // never re-POST an unchanged grid. Each row carries its `id` (so the
  // server can match it to the existing row instead of minting a new one)
  // and `expectedStock` (the stock value this form loaded for it, so the
  // server only ever writes a *changed* stock value, and only as a
  // compare-and-set against that — see replaceVariants' own doc comment).
  async function saveVariantsIfChanged(id: string): Promise<{ ok: boolean; variants: VariantRow[] }> {
    if (!isDirty(variants, initialSnapshot.variants)) return { ok: true, variants };

    const expectedStockById = new Map<string, number>();
    for (const v of initialSnapshot.variants) {
      if (v.id) expectedStockById.set(v.id, v.stock);
    }

    const response = await fetch(`/api/admin/products/${id}/variants`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variants: variants.map((v) => ({
          id: v.id,
          size: v.size,
          color: v.color,
          colorHex: v.colorHex,
          sku: v.sku,
          price: v.price,
          stock: v.stock,
          expectedStock: v.id ? expectedStockById.get(v.id) : undefined,
          active: v.active,
        })),
      }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setErrorMessage(formatApiError(body, "Couldn't save variants.").summary);
      return { ok: false, variants };
    }
    // The server assigns ids to newly-created rows and is the source of
    // truth for what actually landed — re-sync from its response so the
    // next save's dirty-check and expectedStock compare against reality,
    // not this tab's pre-save guess.
    const body = await response.json().catch(() => ({}));
    const synced: VariantRow[] = Array.isArray(body.variants) ? body.variants : variants;
    setVariants(synced);
    return { ok: true, variants: synced };
  }

  /**
   * Returns whether the save actually succeeded (every field, and the
   * variant grid) — publish()/unpublish()/archive()/unarchive() (F-183)
   * call this first when the form is dirty, and bail out without changing
   * status if it returns false, instead of flipping the status live while
   * silently leaving pending field edits unsaved.
   */
  async function saveDraft(): Promise<boolean> {
    setSaveStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});
    setSaved(false);

    const payload = buildPayload();
    // Validated against the form's actual current price/compare-at, not
    // whatever the diffed `payload` happens to carry — buildPayload()
    // omits an unchanged field entirely on an edit (F-336), so `payload`
    // alone can't be trusted to have both.
    const nextPrice = Number(price);
    const nextCompareAt = compareAtPrice === "" ? null : Number(compareAtPrice);
    if (nextCompareAt != null && nextCompareAt <= nextPrice) {
      setSaveStatus("error");
      setErrorMessage("MRP must be greater than the price.");
      setFieldErrors({ compareAtPrice: "MRP must be greater than the price." });
      return false;
    }

    // F-179: validate the variant grid *before* creating or updating
    // anything. A duplicate (size, color)/SKU or an out-of-range
    // stock/price value used to reach the server as a *second*, separate
    // request — the product create/update would already have succeeded,
    // then the variants POST would 400, and (for a new product) the page
    // navigated to the edit URL regardless, discarding the whole grid with
    // no error visible anywhere.
    const variantError = variants.length > 0 ? getVariantGridError(variants) : null;
    if (variantError) {
      setSaveStatus("error");
      setErrorMessage(variantError);
      return false;
    }

    // F-179: choose the request by whether this form has ever actually
    // saved (`productId` is set), not by `isEdit` — `isEdit` is fixed at
    // mount from the `initial` prop and never changes on the /new route.
    // Without this, retrying Save after a first save's *variant* POST
    // failed (see below: the form stays on /new so the grid isn't lost)
    // would `POST` a second product instead of `PATCH`ing the one already
    // created.
    const isFirstSave = !productId;
    const response = await fetch(productId ? `/api/admin/products/${productId}` : "/api/admin/products", {
      method: productId ? "PATCH" : "POST",
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
      return false;
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
    // Only ever non-empty on the very first save: an edit form starts with
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
    // rare case: on success this is normally followed by a navigation to
    // the real edit page (see below), which unmounts this form before any
    // message set here could ever be seen — F-179: *normally*, because
    // that navigation is now conditional on the variant save below too.
    if (isFirstSave && stagedImages.length > 0) {
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

    const variantsResult = await saveVariantsIfChanged(savedId);
    setSaveStatus(variantsResult.ok ? "idle" : "error");

    // F-13/F-179: fold in whatever actually saved. The product fields above
    // always saved successfully by this point (the response was `ok`), so
    // they're never "dirty" against the form's current values any more —
    // but `variants` only updates when the variant save also succeeded;
    // otherwise the *old*, still-actually-saved grid stays the pristine
    // baseline, so the guard correctly keeps treating the edited-but-lost
    // grid as dirty rather than pretending it saved too.
    const fieldsSnapshot = buildSnapshot();
    setInitialSnapshot((prev) => ({ ...fieldsSnapshot, variants: variantsResult.ok ? variantsResult.variants : prev.variants }));

    if (variantsResult.ok) {
      // F-03/F-16: match the Orders page's own "Saved." confirmation
      // pattern (src/components/admin/order-detail-actions.tsx) instead of
      // leaving a save with no visible confirmation at all.
      setSaved(true);
    }

    if (isFirstSave) {
      // F-179: only leave /new once everything actually saved. Previously
      // this always navigated to the edit page, even when the variants
      // POST just 400'd — the admin landed on an edit page with an empty
      // variant grid and no visible reason why. Staying put leaves the
      // grid and the error banner (set inside saveVariantsIfChanged) on
      // screen so the admin can fix the grid and save again.
      if (variantsResult.ok) {
        router.push(`/admin/products/${savedId}`);
      }
    } else {
      router.refresh();
    }
    return variantsResult.ok;
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

  /**
   * F-183: publish/unpublish/archive/unarchive all funnel through here.
   * Previously each one only PATCHed the status flip and then showed
   * "Saved." unconditionally — an admin who edited, say, Price and clicked
   * Publish without clicking Save first saw "Saved." while the product
   * went live (or was archived, etc.) with the *old* field values still in
   * the database. Saving any pending edits first — the same saveDraft()
   * "Save changes" already runs — makes these behave like Shopify's
   * "Save and publish": either everything the admin sees on screen is now
   * live, or nothing is (saveDraft's own error banner explains why and the
   * status is left alone).
   */
  async function runStatusAction(action: "publish" | "unpublish" | "archive" | "unarchive", nextStatus: "ACTIVE" | "DRAFT" | "ARCHIVED") {
    if (!productId) return;
    if (dirty) {
      const saveOk = await saveDraft();
      if (!saveOk) return; // saveDraft already set errorMessage/fieldErrors
    }
    const ok = await runAction(action, () =>
      fetch(`/api/admin/products/${productId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }),
    );
    if (ok) {
      setStatus(nextStatus);
      // Only fold `status` into the pristine snapshot — this action only
      // ever persists the status flip itself; any *other* field either was
      // already folded in by the saveDraft() above, or wasn't dirty to
      // begin with.
      setInitialSnapshot((prev) => ({ ...prev, status: nextStatus }));
      setSaved(true);
      router.refresh();
    }
  }

  async function publish() {
    await runStatusAction("publish", "ACTIVE");
  }

  async function unpublish() {
    await runStatusAction("unpublish", "DRAFT");
  }

  async function archive() {
    await runStatusAction("archive", "ARCHIVED");
  }

  /** F-185: the counterpart to archive() — was previously unreachable from
   * the UI (only Publish showed for an ARCHIVED product, and Delete was
   * disabled for anything but DRAFT), so the only way to get an archived
   * product back to draft, or delete it, was to publish it live again
   * first. */
  async function unarchive() {
    await runStatusAction("unarchive", "DRAFT");
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
    if (!confirm("Delete this product permanently?")) return;
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
        <Field as="div" label="Description" error={fieldErrors.description}>
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
          aria-label="Product category"
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
          <Field
            label="MRP (incl. of all taxes)"
            error={fieldErrors.compareAtPrice}
            hint="The product's declared maximum retail price — shown struck through with a % Off badge when it's above the selling price. Must be a real MRP, not an invented reference price."
          >
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
            productSizes={productSizes}
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

      {/* release-hardening F-311/F-195: India Legal Metrology declarations
          (country of origin, net quantity) and the GST invoice HSN code.
          Every field is optional — blank means the PDP/invoice fall back to
          the store-wide default (country of origin) or just omit the line
          (net quantity, HSN), rather than a phone-typing admin being forced
          to fill these in for every SKU. */}
      <section className="space-y-4 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-display text-lg font-bold text-ink">Compliance / product information</h2>
        <p className="text-xs text-muted">
          Shown on the product page and the GST invoice. Leave blank to use the store default (Settings
          → Legal) where one exists.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Country of origin"
            error={fieldErrors.countryOfOrigin}
            hint="Defaults to India if left blank"
          >
            <input
              value={countryOfOrigin}
              onChange={(e) => setCountryOfOrigin(e.target.value)}
              placeholder="India"
              className={inputClass}
            />
          </Field>
          <Field
            label="Net quantity"
            error={fieldErrors.netQuantity}
            hint={'e.g. "1 N" or "1 set = 2 pcs"'}
          >
            <input value={netQuantity} onChange={(e) => setNetQuantity(e.target.value)} className={inputClass} />
          </Field>
          <Field label="HSN code" error={fieldErrors.hsnCode} hint="For the GST invoice">
            <input value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} className={inputClass} />
          </Field>
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

      <div
        className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lg max-md:bottom-2 max-md:gap-2 max-md:p-2"
        onKeyDown={(event) => {
          if (event.key === "Escape") setMoreOpen(false);
        }}
      >
        {/* F-176: rendered here, as the bar's own first (full-width) row,
            instead of as a separate element right above it — a save error
            used to be scrolled to the bottom of the viewport, exactly
            where this always-visible sticky bar also sits, so the bar hid
            all but a sliver of it. `scroll={false}` because the bar is
            already on screen wherever the admin scrolls to hit Save;
            re-scrolling here would just be a needless jump. */}
        <FormErrorBanner message={errorMessage} scroll={false} className="basis-full" />

        <button
          type="button"
          onClick={saveDraft}
          disabled={saveStatus === "saving" || !name.trim() || !price || Boolean(variantGridError)}
          title={variantGridError ?? ""}
          className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 max-md:min-h-11 max-md:flex-1 max-md:px-4"
        >
          {saveStatus === "saving" ? "Saving…" : status === "DRAFT" ? "Save draft" : "Save changes"}
        </button>

        {/* F-183: was `saved && !errorMessage` — publish()/unpublish()/
            archive() used to flip the status alone and still show "Saved."
            even when other fields were edited but never persisted (or the
            pre-save this now runs first failed). Requiring `!dirty` too is
            the safety net under that fix: it stays accurate even if a
            future caller sets `saved` without going through saveDraft(). */}
        {saved && !dirty && !errorMessage ? (
          <span className="text-xs font-medium text-green-700 max-md:order-last max-md:basis-full max-md:text-center">Saved.</span>
        ) : null}

        {status === "ARCHIVED" ? (
          // F-185: previously this branch fell through to the plain
          // "Publish" button below (status !== "ACTIVE"), so the only way
          // to get an archived product back to DRAFT — or to delete it —
          // was to publish it live again first, then unpublish, then
          // delete. Unarchive needs `products:manage`, not
          // `products:publish` (see the /publish route's own comment), so
          // it's never gated on `canPublish`.
          <button type="button" onClick={unarchive} disabled={!productId || busyAction === "unarchive"} className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11 max-md:px-4">
            Unarchive
          </button>
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={status === "ACTIVE"}
            aria-label="Product listing"
            onClick={status === "ACTIVE" ? unpublish : publish}
            disabled={!canPublish || !productId || busyAction !== null || saveStatus === "saving"}
            title={!canPublish ? "Requires products:publish" : !productId ? "Save this product before listing" : status === "ACTIVE" ? "Unlist this product" : "List this product"}
            className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11"
          >
            <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition-colors ${status === "ACTIVE" ? "bg-green-600" : "bg-gray-300"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${status === "ACTIVE" ? "translate-x-[18px]" : "translate-x-0.5"}`} />
            </span>
            Listing {busyAction === "publish" || busyAction === "unpublish" ? "saving…" : status === "ACTIVE" ? "on" : "off"}
          </button>
        )}

        {/* F-065: on phones these four actions sit in a popover opened by the
            "More" button; from md up the wrapper is `display: contents`, so
            they are laid out inline in the bar exactly as before. One set of
            buttons either way (no duplicated handlers or state). */}
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls={moreMenuId}
          onClick={() => setMoreOpen((open) => !open)}
          className="inline-flex min-h-11 items-center rounded-full border border-border px-4 py-2 text-sm font-semibold text-ink md:hidden"
        >
          More
          <span aria-hidden="true" className="ml-1">{moreOpen ? "▾" : "▴"}</span>
        </button>

        <div
          id={moreMenuId}
          onClick={() => setMoreOpen(false)}
          className={
            moreOpen
              ? "max-md:absolute max-md:bottom-full max-md:right-0 max-md:mb-2 max-md:flex max-md:w-64 max-md:max-w-full max-md:flex-col max-md:gap-1 max-md:rounded-2xl max-md:border max-md:border-border max-md:bg-surface max-md:p-2 max-md:shadow-lg md:contents"
              : "max-md:hidden md:contents"
          }
        >
          {isEdit && (
            // F-184: duplicate() copies the last *saved* DB row — with no
            // guard, a dirty form's edits were silently dropped (the copy
            // never reflected them) with no warning, unlike every other
            // navigation away from a dirty form.
            <span title={dirty ? "Save your changes before duplicating" : ""} className="max-md:block">
              <button
                type="button"
                onClick={duplicate}
                disabled={dirty || busyAction === "duplicate"}
                aria-describedby={dirty ? duplicateHintId : undefined}
                className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40 disabled:cursor-not-allowed disabled:opacity-50 max-md:min-h-11 max-md:w-full max-md:text-left"
              >
                Duplicate
              </button>
              {/* A `title` tooltip is unreachable on touch, so the reason a
                  button is disabled is also written out on phones. */}
              {dirty ? (
                <span id={duplicateHintId} className="mt-1 block px-1 text-[11px] text-muted md:hidden">
                  Save your changes before duplicating.
                </span>
              ) : null}
            </span>
          )}

          {isEdit && status !== "ARCHIVED" && (
            <button
              type="button"
              onClick={archive}
              disabled={busyAction === "archive"}
              className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40 max-md:min-h-11 max-md:w-full max-md:text-left"
            >
              Archive
            </button>
          )}

          {isEdit && (
            <span title={canDelete ? "" : "Only draft or archived products with no orders can be deleted"} className="max-md:block">
              <button
                type="button"
                onClick={remove}
                disabled={!canDelete || busyAction === "delete"}
                aria-describedby={canDelete ? undefined : deleteHintId}
                className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-red-600 disabled:cursor-not-allowed disabled:opacity-40 max-md:min-h-11 max-md:w-full max-md:text-left"
              >
                Delete
              </button>
              {canDelete ? null : (
                <span id={deleteHintId} className="mt-1 block px-1 text-[11px] text-muted md:hidden">
                  Only draft or archived products with no orders can be deleted.
                </span>
              )}
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
            className="ml-auto rounded-full px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40 max-md:ml-0 max-md:min-h-11 max-md:w-full max-md:text-left"
          >
            Back to list
          </button>
        </div>
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
function Field({
  label,
  hint,
  error,
  children,
  as = "label",
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactElement;
  /**
   * F-186: a plain `<input>`/`<select>`/`<textarea>` is a single labelable
   * element, so wrapping it in a `<label>` (the default) both shows and
   * programmatically associates the caption for free. `RichTextEditor` is a
   * composite widget with its own toolbar buttons *inside* `children` —
   * wrapped in a `<label>`, a click anywhere in the control (including the
   * caption text) activates the label's first labelable descendant, which
   * is the toolbar's Bold button, silently toggling bold on every click.
   * Pass `as="div"` for a composite control: the caption gets an id and is
   * wired to the control via `aria-labelledby` instead, so the accessible
   * name is preserved without label-activation semantics.
   */
  as?: "label" | "div";
}) {
  const errorId = useId();
  const labelId = useId();
  const control = cloneElement(children as ReactElement<Record<string, unknown>>, {
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? errorId : undefined,
    ...(as === "div" ? { "aria-labelledby": labelId } : {}),
  });
  const Wrapper = as;
  return (
    <Wrapper className="block">
      <span id={as === "div" ? labelId : undefined} className="mb-1 block text-xs font-semibold text-muted">
        {label}
      </span>
      {control}
      {error ? (
        <span id={errorId} className="mt-1 block text-[11px] font-medium text-red-600">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-muted">{hint}</span>
      ) : null}
    </Wrapper>
  );
}
