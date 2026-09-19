"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MediaPicker, type PickedAsset } from "@/components/admin/media-picker";
import { FormErrorBanner } from "@/components/admin/form-error-banner";
import { useUnsavedChangesGuard, useUnsavedChangesNav } from "@/components/admin/unsaved-changes";
import { SECTION_LABELS, categorySectionValues } from "@/lib/catalog/category-validation";
import { isDirty } from "@/lib/admin/is-dirty";
import { formatApiError } from "@/lib/validation/format-api-error";

type Section = (typeof categorySectionValues)[number];

export interface CategoryOption {
  id: string;
  name: string;
  section: Section;
  parentId: string | null;
}

export interface SizeChartOption {
  id: string;
  name: string;
}

export interface CategoryFormInitial {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  section: Section;
  parentId: string | null;
  sizeChartId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  active: boolean;
  showInMenu: boolean;
  image: PickedAsset | null;
}

/** Every id in `options` that is `rootId` itself or a descendant of it —
 * used to keep the parent picker from offering a cycle. */
function selfAndDescendantIds(rootId: string, options: CategoryOption[]): Set<string> {
  const ids = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const option of options) {
      if (option.parentId && ids.has(option.parentId) && !ids.has(option.id)) {
        ids.add(option.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function CategoryForm({
  initial,
  categoryOptions,
  sizeChartOptions,
}: {
  initial?: CategoryFormInitial;
  categoryOptions: CategoryOption[];
  sizeChartOptions: SizeChartOption[];
}) {
  const router = useRouter();
  const isEdit = Boolean(initial?.id);

  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [section, setSection] = useState<Section>(initial?.section ?? "GENERAL");
  const [parentId, setParentId] = useState<string>(initial?.parentId ?? "");
  const [sizeChartId, setSizeChartId] = useState<string>(initial?.sizeChartId ?? "");
  const [seoTitle, setSeoTitle] = useState(initial?.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(initial?.seoDescription ?? "");
  const [active, setActive] = useState(initial?.active ?? true);
  const [showInMenu, setShowInMenu] = useState(initial?.showInMenu ?? true);
  const [image, setImage] = useState<PickedAsset | null>(initial?.image ?? null);

  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // F-13: unsaved-changes protection — see product-form.tsx's own
  // buildSnapshot() for the fuller rationale. `image` is included since,
  // unlike product-form's gallery, MediaPicker here just stages a pick
  // locally until Save/Create is clicked.
  function buildSnapshot() {
    return { name, slug, description, section, parentId, sizeChartId, seoTitle, seoDescription, active, showInMenu, imageId: image?.id ?? null };
  }
  const [initialSnapshot] = useState(buildSnapshot);
  const dirty = isDirty(buildSnapshot(), initialSnapshot);
  useUnsavedChangesGuard(dirty);
  const { confirmLeave } = useUnsavedChangesNav();

  const excludedParentIds = useMemo(
    () => (initial ? selfAndDescendantIds(initial.id, categoryOptions) : new Set<string>()),
    [initial, categoryOptions],
  );

  const eligibleParents = useMemo(
    () => categoryOptions.filter((c) => c.section === section && !excludedParentIds.has(c.id)),
    [categoryOptions, section, excludedParentIds],
  );

  const onNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, ""),
      );
    }
  };

  const onSectionChange = (value: Section) => {
    setSection(value);
    // A parent from a different section is no longer valid — clear it
    // rather than silently submitting a mismatched pair.
    if (parentId) {
      const stillValid = categoryOptions.some((c) => c.id === parentId && c.section === value);
      if (!stillValid) setParentId("");
    }
  };

  const save = async () => {
    setStatus("saving");
    setErrorMessage(null);
    setFieldErrors({});

    const payload = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || null,
      section,
      parentId: parentId || null,
      imageId: image?.id ?? null,
      sizeChartId: sizeChartId || null,
      seoTitle: seoTitle.trim() || null,
      seoDescription: seoDescription.trim() || null,
      active,
      showInMenu,
    };

    const response = await fetch(isEdit ? `/api/admin/categories/${initial!.id}` : "/api/admin/categories", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      // F-02: same silent-failure pattern as the product form — see
      // src/lib/validation/format-api-error.ts.
      const body = await response.json().catch(() => ({}));
      const { summary, fieldErrors: fe } = formatApiError(body, "Couldn't save — check the fields above.");
      setStatus("error");
      setErrorMessage(summary);
      setFieldErrors(fe);
      return;
    }

    router.push("/admin/categories");
    router.refresh();
  };

  return (
    <div className="max-w-3xl space-y-6 rounded-2xl border border-border bg-surface p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" error={fieldErrors.name}>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="Slug" error={fieldErrors.slug} hint="Lowercase letters, numbers, and hyphens">
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <Field label="Description" error={fieldErrors.description}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Section" error={fieldErrors.section}>
          <select
            value={section}
            onChange={(e) => onSectionChange(e.target.value as Section)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          >
            {categorySectionValues.map((value) => (
              <option key={value} value={value}>
                {SECTION_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Parent category" error={fieldErrors.parentId} hint="Must be in the same section">
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          >
            <option value="">None — top level</option>
            {eligibleParents.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Size chart" error={fieldErrors.sizeChartId} hint="Products in this category inherit this unless overridden">
        <select
          value={sizeChartId}
          onChange={(e) => setSizeChartId(e.target.value)}
          className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
        >
          <option value="">None</option>
          {sizeChartOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <p className="mb-2 text-xs font-semibold text-muted">Image</p>
        <MediaPicker usage="CATEGORY" value={image} onChange={setImage} aiFields={{ name, category: SECTION_LABELS[section] }} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SEO title" error={fieldErrors.seoTitle}>
          <input
            value={seoTitle}
            onChange={(e) => setSeoTitle(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
        <Field label="SEO description" error={fieldErrors.seoDescription}>
          <input
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            className="w-full rounded-xl border border-border p-2.5 text-sm text-ink outline-none focus:border-brand"
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={showInMenu} onChange={(e) => setShowInMenu(e.target.checked)} />
          Show in menu
        </label>
      </div>

      <FormErrorBanner message={errorMessage} />

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === "saving" || !name.trim()}
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : isEdit ? "Save changes" : "Create category"}
        </button>
        <button
          type="button"
          onClick={() => {
            // F-13 — see product-form.tsx's "Back to list" button for why.
            if (!confirmLeave()) return;
            router.push("/admin/categories");
          }}
          className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted hover:bg-lilac/40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] font-medium text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}
