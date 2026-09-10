import { Category } from "@/models";
import { successResponse, createdResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import {
  MAX_CATEGORY_DEPTH,
  getResultingCategoryDepth,
} from "@/lib/catalog/categories";
import { withApi } from "@/lib/api/handler";
import {
  parseListQuery,
  runListQuery,
  listResponse,
} from "@/lib/api/list-query";
import { isAdmin } from "@/lib/access/rbac";
import mongoose from "mongoose";
import { revalidateCategoryContent } from "@/lib/cache-invalidation";
import { slugify } from "@/lib/strings";
import { z } from "zod";
import { validateBody } from "@/lib/api/validate";

function isPlaceholderCategorySlug(value: string) {
  return /^category-handle(?:-\d+)?$/.test(value);
}

function getRequestedSlug(body: Record<string, unknown>) {
  const directSlug = typeof body.slug === "string" ? body.slug : "";
  const seo = body.seo as { slug?: unknown } | undefined;
  const seoSlug = typeof seo?.slug === "string" ? seo.slug : "";
  const slug = slugify(directSlug || seoSlug);
  return isPlaceholderCategorySlug(slug) ? "" : slug;
}

async function getUniqueCategorySlug(baseSlug: string) {
  let candidate = baseSlug;
  let suffix = 1;

  while (await Category.exists({ slug: candidate })) {
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }

  return candidate;
}

function normalizeSeo(body: Record<string, unknown>) {
  const seo = body.seo as
    | { pageTitle?: unknown; metaDescription?: unknown; tags?: unknown }
    | undefined;
  const pageTitle =
    typeof seo?.pageTitle === "string" ? seo.pageTitle.trim() : "";
  const metaDescription =
    typeof seo?.metaDescription === "string"
      ? seo.metaDescription.trim()
      : "";
  const tags = Array.isArray(seo?.tags)
    ? Array.from(
        new Set(
          seo.tags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
        ),
      )
    : [];

  if (!pageTitle && !metaDescription && tags.length === 0) return undefined;

  return {
    ...(pageTitle ? { pageTitle } : {}),
    ...(metaDescription ? { metaDescription } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

// Shape check + allow-list: only these keys reach `Category.create` / `$set`.
const CategoryCreateSchema = z.object({
  name: z.string().trim().min(1, "Category name is required").max(120),
  slug: z.string().max(120).optional(),
  description: z.string().max(5000).optional(),
  image: z.string().max(2048).optional(),
  icon: z.string().max(200).optional(),
  parentId: z.string().max(64).nullable().optional(),
  displayOrder: z.number().optional(),
  order: z.number().optional(),
  isActive: z.boolean().optional(),
  featured: z.boolean().optional(),
  seo: z.record(z.string(), z.unknown()).optional(),
  options: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
});

/**
 * GET /api/categories
 * Fetch all categories with optional hierarchy or pagination
 */
export const GET = withApi({ auth: "optional" }, async ({ request, session }) => {
  const searchParams = request.nextUrl.searchParams;
  const parentOnly = searchParams.get("parentOnly") === "true";
  const flat = searchParams.get("flat") === "true";
  const status = searchParams.get("status");
  const featured = searchParams.get("featured");

  // Build query
  const query: Record<string, unknown> = { isActive: true };

  if (isAdmin(session?.user)) {
    delete query.isActive; // Admin sees all by default

    // Admin can filter by status
    if (status === "active") {
      query.isActive = true;
    } else if (status === "inactive") {
      query.isActive = false;
    } else if (status === "featured") {
      query.featured = true;
    }
  }

  if (featured === "true") {
    query.featured = true;
  } else if (featured === "false") {
    query.featured = { $ne: true };
  }

  if (parentOnly) {
    query.parentId = null;
  }

  const listQuery = parseListQuery(request.nextUrl.searchParams, {
    allowedSortFields: ["name", "productCount", "createdAt", "updatedAt", "order"],
    defaultSort: { order: 1, name: 1 },
    tieBreaker: { name: 1 },
  });

  const search = listQuery.search;
  if (search) {
    const pattern = { $regex: search, $options: "i" };
    query.$or = [{ name: pattern }, { slug: pattern }];
  }

  // Paginated response for admin table
  if (listQuery.usePagination) {
    const result = await runListQuery(Category, query, listQuery, {
      populate: "subcategories",
    });
    return listResponse(result, listQuery);
  }

  // Projection = exactly what the consumers of this branch read: the admin
  // categories table (slug/image/isActive/featured/productCount), the category
  // and collection pickers (name/slug/image/path), and the menu builder's
  // resource search + mega-menu sync (name/slug/description/image/icon).
  // `parentId` feeds the path/isLeaf decoration and the nested tree below.
  // `subcategories` is a virtual, so populating it duplicated every child
  // document inside its parent — nothing reads it off this response.
  const categories = await Category.find(query)
    .select(
      "name slug description image icon parentId isActive featured productCount",
    )
    .sort({ order: 1, name: 1 })
    .lean();

  // Decorate every category with a `path` (ancestor names ending in self)
  // and `isLeaf` (true when no children). The product editor uses these to
  // show breadcrumbs and disable parent selection. Cheap to compute since
  // we already have all categories in memory.
  const byId = new Map(categories.map((c) => [String(c._id), c]));
  const childCount = new Map<string, number>();
  for (const c of categories) {
    if (c.parentId) {
      const key = String(c.parentId);
      childCount.set(key, (childCount.get(key) || 0) + 1);
    }
  }
  const pathCache = new Map<string, string[]>();
  function pathFor(id: string): string[] {
    const cached = pathCache.get(id);
    if (cached) return cached;
    const cat = byId.get(id);
    if (!cat) return [];
    const parent = cat.parentId ? pathFor(String(cat.parentId)) : [];
    const result = [...parent, cat.name];
    pathCache.set(id, result);
    return result;
  }
  const decorated = categories.map((c) => {
    const id = String(c._id);
    return {
      ...c,
      path: pathFor(id),
      isLeaf: !childCount.get(id),
    };
  });

  // Build hierarchy if not flat
  if (!flat && !parentOnly && !search) {
    const categoriesMap = new Map();
    const rootCategories: unknown[] = [];

    // First pass: create map
    decorated.forEach((cat) => {
      categoriesMap.set(cat._id.toString(), { ...cat, children: [] });
    });

    // Second pass: build tree
    decorated.forEach((cat) => {
      const category = categoriesMap.get(cat._id.toString());
      if (cat.parentId) {
        const parent = categoriesMap.get(cat.parentId.toString());
        if (parent) {
          parent.children.push(category);
        }
      } else {
        rootCategories.push(category);
      }
    });

    return successResponse(rootCategories);
  }

  return successResponse(decorated);
});

/**
 * POST /api/categories
 * Create a new category (Admin only)
 */
export const POST = withApi({ auth: "admin" }, async ({ request }) => {
  const body = await validateBody(request, CategoryCreateSchema);

  if (body.parentId === "" || body.parentId === null) {
    body.parentId = null;
  } else if (body.parentId !== undefined) {
    if (!mongoose.Types.ObjectId.isValid(body.parentId)) {
      throw new ValidationError("Invalid parent category ID");
    }
    const parentExists = await Category.exists({ _id: body.parentId });
    if (!parentExists) {
      throw new ValidationError("Parent category not found");
    }
    // Three levels is what the storefront draws, so a fourth is refused here
    // rather than created and then quietly skipped by every surface.
    const depth = await getResultingCategoryDepth(body.parentId);
    if (depth > MAX_CATEGORY_DEPTH) {
      throw new ValidationError(
        `Categories nest ${MAX_CATEGORY_DEPTH} levels deep. That parent is already at level ${MAX_CATEGORY_DEPTH}, so pick a higher one.`,
      );
    }
  }

  const requestedSlug = getRequestedSlug(body);
  const slug = requestedSlug || slugify(String(body.name || ""));
  if (!slug) {
    throw new ValidationError("Category name is required");
  }
  const seo = normalizeSeo(body);
  if (seo) {
    body.seo = seo;
  } else {
    delete body.seo;
  }

  const finalSlug = await getUniqueCategorySlug(slug);

  const category = await Category.create({
    ...body,
    // "" / null both mean "top level"; the model's default takes over.
    parentId: body.parentId || undefined,
    slug: finalSlug,
    order: body.displayOrder || 0,
  });

  revalidateCategoryContent({ slugs: [category.slug] });

  return createdResponse(category);
});
