import { Category, Product } from "@/models";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { ValidationError } from "@/lib/api/errors";
import mongoose from "mongoose";
import { revalidateCategoryContent } from "@/lib/cache-invalidation";
import { withApi } from "@/lib/api/handler";
import {
  MAX_CATEGORY_DEPTH,
  getResultingCategoryDepth,
} from "@/lib/catalog/categories";
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

async function getUniqueCategorySlug(baseSlug: string, categoryId: string) {
  let candidate = baseSlug;
  let suffix = 1;

  while (
    await Category.exists({
      slug: candidate,
      _id: { $ne: categoryId },
    })
  ) {
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
const CategoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
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
 * GET /api/categories/[id]
 * Get single category by ID OR Slug
 */
export const GET = withApi<{ id: string }>(
  {},
  async ({ params }) => {
    const { id } = params;

    // Check if valid ObjectId, if so try finding by ID first
    let category;
    if (mongoose.Types.ObjectId.isValid(id)) {
      category = await Category.findById(id).lean();
    }

    // If not found by ID (or invalid ID), try finding by slug
    if (!category) {
      category = await Category.findOne({ slug: id }).lean();
    }

    if (!category) {
      return notFoundResponse("Category");
    }

    return successResponse(category);
  },
);

/**
 * PUT /api/categories/[id]
 * Update category (Admin only) - requires ID
 */
export const PUT = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const { id } = params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Invalid category ID");
    }

    const body = await validateBody(request, CategoryUpdateSchema);

    const existingCategory = await Category.findById(id).select("slug").lean();
    if (!existingCategory) {
      return notFoundResponse("Category");
    }

    const requestedSlug = getRequestedSlug(body);
    if (requestedSlug) {
      const existing = await Category.findOne({
        slug: requestedSlug,
        _id: { $ne: id },
      });
      if (existing) {
        throw new ValidationError("Category URL handle is already in use");
      }
      body.slug = requestedSlug;
    } else if (
      isPlaceholderCategorySlug(String(existingCategory.slug || "")) &&
      typeof body.name === "string"
    ) {
      const nameSlug = slugify(body.name);
      if (nameSlug) {
        body.slug = await getUniqueCategorySlug(nameSlug, id);
      }
    }
    const seo = normalizeSeo(body);
    if (seo) {
      body.seo = seo;
    } else {
      delete body.seo;
    }

    // Remap displayOrder to order
    if (body.displayOrder !== undefined) {
      body.order = body.displayOrder;
      delete body.displayOrder;
    }

    if (body.parentId !== undefined) {
      if (body.parentId === "" || body.parentId === null) {
        body.parentId = null;
      } else if (!mongoose.Types.ObjectId.isValid(body.parentId)) {
        throw new ValidationError("Invalid parent category ID");
      } else if (String(body.parentId) === String(id)) {
        throw new ValidationError("Category cannot be its own parent");
      } else {
        const visited = new Set<string>([String(id)]);
        let currentParentId: string | null = String(body.parentId);
        while (currentParentId) {
          if (visited.has(currentParentId)) {
            throw new ValidationError("Category parent would create a circular reference");
          }
          visited.add(currentParentId);
          const parent = await Category.findById(currentParentId)
            .select("parentId")
            .lean() as { parentId?: unknown } | null;
          if (!parent) {
            throw new ValidationError("Parent category not found");
          }
          currentParentId = parent.parentId ? String(parent.parentId) : null;
        }

        // Re-parenting carries the whole branch along, so a category with
        // children can only move as deep as its own height allows.
        const depth = await getResultingCategoryDepth(body.parentId, id);
        if (depth > MAX_CATEGORY_DEPTH) {
          throw new ValidationError(
            `Categories nest ${MAX_CATEGORY_DEPTH} levels deep. Moving this one there would reach level ${depth}.`,
          );
        }
      }
    }

    const category = await Category.findByIdAndUpdate(
      id,
      { $set: body },
      { new: true, runValidators: true }
    );

    if (!category) {
      return notFoundResponse("Category");
    }

    revalidateCategoryContent({
      slugs: [String(existingCategory.slug || ""), String(category.slug || "")],
    });

    return successResponse(category);
  },
);

/**
 * DELETE /api/categories/[id]
 * Delete category (Admin only) - requires ID
 */
export const DELETE = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ params }) => {
    const { id } = params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return notFoundResponse("Invalid category ID");
    }

    // Check if category has children
    const hasChildren = await Category.exists({ parentId: id });
    if (hasChildren) {
      throw new Error("Cannot delete category with subcategories");
    }

    // Block deletion while products still reference this category. `category`
    // is a required field on Product, so deleting anyway would leave dangling
    // ObjectIds (broken breadcrumbs, products missing from all navigation).
    const productCount = await Product.countDocuments({ category: id });
    if (productCount > 0) {
      throw new Error(
        `Cannot delete category: ${productCount} product(s) still use it. Reassign them first.`,
      );
    }

    const category = await Category.findByIdAndDelete(id);

    if (!category) {
      return notFoundResponse("Category");
    }

    revalidateCategoryContent({ slugs: [String(category.slug || "")] });

    return successResponse({ message: "Category deleted successfully" });
  },
);
