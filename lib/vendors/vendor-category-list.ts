import mongoose from "mongoose";
import { Category, Product } from "@/models";
import { connectDB } from "@/lib/db";
import type { ListResult } from "@/lib/api/list-query";

/**
 * Vendor category list query.
 *
 * Shared by `GET /api/vendor/categories` and the vendor categories page's
 * server component so the endpoint and the rendered page always agree on what
 * a given query string means.
 *
 * Like collections, a vendor's categories are derived from its own products
 * rather than owned, so the list pages in memory over a bounded set.
 */

interface VendorCategoryRow {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parentId?: string | null;
  parentName?: string | null;
  isActive: boolean;
  productCount: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function fetchVendorCategoryList(
  searchParams: URLSearchParams,
  vendorRef: mongoose.Types.ObjectId | string,
): Promise<ListResult<unknown>> {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
  const search = searchParams.get("search")?.trim() || "";
  const status = searchParams.get("status") || "all";
  const sortBy = searchParams.get("sortBy") || "name";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  await connectDB();

  const vendorId = new mongoose.Types.ObjectId(String(vendorRef));

  const grouped = await Product.aggregate<{ _id: mongoose.Types.ObjectId; productCount: number }>([
    { $match: { vendorId, category: { $ne: null } } },
    { $group: { _id: "$category", productCount: { $sum: 1 } } },
  ]);

  const countByCategory = new Map(grouped.map((item) => [String(item._id), item.productCount]));
  const categoryIds = grouped.map((item) => item._id);

  const categoryQuery: Record<string, unknown> = { _id: { $in: categoryIds } };
  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    categoryQuery.name = { $regex: escapedSearch, $options: "i" };
  }
  if (status === "active") categoryQuery.isActive = true;
  if (status === "inactive") categoryQuery.isActive = false;

  const categories = await Category.find(categoryQuery)
    .select("name slug description image parentId isActive createdAt updatedAt")
    .lean();

  const parentIds = Array.from(
    new Set(categories.map((category) => category.parentId).filter(Boolean).map(String)),
  );
  const parents = parentIds.length
    ? await Category.find({ _id: { $in: parentIds } }).select("name").lean()
    : [];
  const parentNameById = new Map(parents.map((parent) => [String(parent._id), parent.name]));

  const rows: VendorCategoryRow[] = categories.map((category) => ({
    _id: String(category._id),
    name: category.name,
    slug: category.slug,
    description: category.description,
    image: category.image,
    parentId: category.parentId ? String(category.parentId) : null,
    parentName: category.parentId ? parentNameById.get(String(category.parentId)) || null : null,
    isActive: category.isActive,
    productCount: countByCategory.get(String(category._id)) || 0,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  }));

  const sortSelectors: Record<string, (row: VendorCategoryRow) => string | number | boolean> = {
    name: (row) => row.name,
    productCount: (row) => row.productCount,
    status: (row) => row.isActive,
    createdAt: (row) => (row.createdAt ? new Date(row.createdAt).getTime() : 0),
    updatedAt: (row) => (row.updatedAt ? new Date(row.updatedAt).getTime() : 0),
  };
  const getSortValue = sortSelectors[sortBy] || sortSelectors.name;
  rows.sort((a, b) => {
    const aValue = getSortValue(a);
    const bValue = getSortValue(b);
    if (typeof aValue === "number" && typeof bValue === "number") {
      return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
    }
    const compare = String(aValue).localeCompare(String(bValue), undefined, {
      sensitivity: "base",
      numeric: true,
    });
    return sortOrder === "asc" ? compare : -compare;
  });

  const total = rows.length;
  const totalPages = Math.ceil(total / limit);
  const skip = (page - 1) * limit;

  return {
    items: rows.slice(skip, skip + limit),
    page,
    limit,
    total,
    totalPages,
  };
}
