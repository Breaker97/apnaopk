import mongoose from "mongoose";
import { Brand, Product } from "@/models";
import { connectDB } from "@/lib/db";
import {
  APPROVED_BRAND_CONDITION,
  BRAND_APPROVAL_STATUS,
} from "@/lib/catalog/brands";
import type { ListResult } from "@/lib/api/list-query";

/**
 * Vendor brand list query.
 *
 * Shared by `GET /api/vendor/brands` and the vendor brands page's server
 * component so the endpoint and the rendered page always agree on what a
 * given query string means.
 *
 * Vendors see the shared catalogue of approved brands plus every brand they
 * own, including ones still in moderation; soft-deleted brands are hidden.
 */

interface VendorBrandRow {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  website?: string;
  isActive: boolean;
  featured: boolean;
  productCount: number;
  approvalStatus: "approved" | "pending" | "rejected";
  rejectionReason?: string;
  // True when this brand is owned by the requesting vendor (editable by them).
  isOwn: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function fetchVendorBrandList(
  searchParams: URLSearchParams,
  vendorRef: mongoose.Types.ObjectId | string,
): Promise<ListResult<unknown>> {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("limit") || "10", 10)),
  );
  const search = searchParams.get("search")?.trim() || "";
  const status = searchParams.get("status") || "all";
  const sortBy = searchParams.get("sortBy") || "name";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  await connectDB();

  const vendorId = new mongoose.Types.ObjectId(String(vendorRef));

  const grouped = await Product.aggregate<{
    _id: mongoose.Types.ObjectId;
    productCount: number;
  }>([
    { $match: { vendorId, brand: { $ne: null } } },
    { $group: { _id: "$brand", productCount: { $sum: 1 } } },
  ]);
  const countByBrand = new Map(
    grouped.map((item) => [String(item._id), item.productCount]),
  );

  // Vendors see the shared catalog of approved brands plus every brand they
  // own (including pending/rejected ones still in moderation). Soft-deleted
  // brands are always hidden.
  const brandQuery: Record<string, unknown> = {
    deletedAt: null,
    $or: [
      { approvalStatus: APPROVED_BRAND_CONDITION },
      { ownerVendorId: vendorId },
    ],
  };
  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    brandQuery.name = { $regex: escapedSearch, $options: "i" };
  }
  if (status === "active") brandQuery.isActive = true;
  if (status === "inactive") brandQuery.isActive = false;
  if (status === "featured") brandQuery.featured = true;
  if (status === "pending")
    brandQuery.approvalStatus = BRAND_APPROVAL_STATUS.PENDING;

  const brands = await Brand.find(brandQuery)
    .select(
      "name slug description logo website isActive featured ownerVendorId approvalStatus rejectionReason createdAt updatedAt",
    )
    .lean();

  const rows: VendorBrandRow[] = brands.map((brand) => ({
    _id: String(brand._id),
    name: brand.name,
    slug: brand.slug,
    description: brand.description,
    logo: brand.logo,
    website: brand.website,
    isActive: Boolean(brand.isActive),
    featured: Boolean(brand.featured),
    productCount: countByBrand.get(String(brand._id)) || 0,
    approvalStatus: brand.approvalStatus || BRAND_APPROVAL_STATUS.APPROVED,
    rejectionReason: brand.rejectionReason,
    isOwn: brand.ownerVendorId
      ? String(brand.ownerVendorId) === String(vendorId)
      : false,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
  }));

  const sortSelectors: Record<
    string,
    (row: VendorBrandRow) => string | number | boolean
  > = {
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
