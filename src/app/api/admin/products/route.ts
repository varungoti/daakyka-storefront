import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { hasPermission } from "@/lib/auth/rbac";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  createProduct,
  InvalidCompareAtPriceError,
  listProductsForAdmin,
  ProductCategoryNotFoundError,
  ProductNotPublishableError,
  productInputSchema,
  ProductSizeChartNotFoundError,
  ProductSlugConflictError,
  serializeProductForResponse,
  productStatusValues,
} from "@/lib/catalog/products";

export async function GET(request: Request) {
  const { error } = await requireAdminPermission("products:view");
  if (error) return error;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const stockFilter = url.searchParams.get("stockFilter");
  const sort = url.searchParams.get("sort");
  const validSorts = ["name-asc", "name-desc", "price-asc", "price-desc", "updated-desc", "stock-asc"] as const;

  const result = await listProductsForAdmin({
    search: url.searchParams.get("search") ?? undefined,
    // F-177: the admin table's category filter sends the chosen
    // category's id, not its slug — categoryId (with descendant-category
    // expansion) is the one that actually matches it. categorySlug stays
    // for any other caller still using the old param.
    categoryId: url.searchParams.get("categoryId") ?? undefined,
    categorySlug: url.searchParams.get("categorySlug") ?? undefined,
    status: status && (productStatusValues as readonly string[]).includes(status) ? (status as (typeof productStatusValues)[number]) : undefined,
    stockFilter: stockFilter === "low" || stockFilter === "out" ? stockFilter : "all",
    sort: sort && (validSorts as readonly string[]).includes(sort) ? (sort as (typeof validSorts)[number]) : undefined,
    page: Number(url.searchParams.get("page")) || 1,
    pageSize: Number(url.searchParams.get("pageSize")) || undefined,
  });

  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("products:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = productInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  // F-063: creating a product already ACTIVE is "publishing" it, the one
  // thing CATALOG_MANAGER (products:manage without products:publish) is
  // documented as not being able to do — the dedicated /publish route
  // already enforces this; this was the direct-to-ACTIVE bypass of it.
  if (parsed.data.status === "ACTIVE" && !hasPermission(session.role, "products:publish")) {
    return NextResponse.json({ error: "Publishing requires products:publish" }, { status: 403 });
  }

  try {
    const product = await createProduct(parsed.data, session.id);
    return NextResponse.json({ product: serializeProductForResponse(product) }, { status: 201 });
  } catch (err) {
    if (err instanceof ProductSlugConflictError) {
      return NextResponse.json({ error: err.message, issues: [{ path: ["slug"], message: err.message }] }, { status: 409 });
    }
    if (err instanceof ProductNotPublishableError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ProductCategoryNotFoundError || err instanceof ProductSizeChartNotFoundError || err instanceof InvalidCompareAtPriceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
