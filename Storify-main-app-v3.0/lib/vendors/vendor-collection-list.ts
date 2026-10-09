import mongoose from "mongoose";
import { Collection, Product } from "@/models";
import { connectDB } from "@/lib/db";
import type { ListResult } from "@/lib/api/list-query";

/**
 * Vendor collection list query.
 *
 * Shared by `GET /api/vendor/collections` and the vendor collections page's
 * server component so the endpoint and the rendered page always agree on what
 * a given query string means.
 *
 * A vendor's collections are derived, not owned: the list is whichever shared
 * collections its own products belong to, with a per-vendor product count. It
 * therefore pages in memory — the set is bounded by the vendor's catalogue.
 */

interface VendorCollectionRow {
  _id: string;
  title: string;
  slug: string;
  description?: string;
  image?: { url: string; alt?: string };
  collectionType: "manual" | "automated";
  status: "active" | "draft";
  productCount: number;
  publishing: {
    onlineStore: boolean;
    pointOfSale: boolean;
  };
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function fetchVendorCollectionList(
  searchParams: URLSearchParams,
  vendorRef: mongoose.Types.ObjectId | string,
): Promise<ListResult<unknown>> {
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
  const search = searchParams.get("search")?.trim() || "";
  const status = searchParams.get("status") || "all";
  const type = searchParams.get("type") || "all";
  const sortBy = searchParams.get("sortBy") || "createdAt";
  const sortOrder = searchParams.get("sortOrder") === "asc" ? "asc" : "desc";

  await connectDB();

  const vendorId = new mongoose.Types.ObjectId(String(vendorRef));

  const grouped = await Product.aggregate<{ _id: mongoose.Types.ObjectId; productCount: number }>([
    { $match: { vendorId, collectionIds: { $exists: true, $ne: [] } } },
    { $unwind: "$collectionIds" },
    { $group: { _id: "$collectionIds", productCount: { $sum: 1 } } },
  ]);

  const countByCollection = new Map(grouped.map((item) => [String(item._id), item.productCount]));
  const collectionIds = grouped.map((item) => item._id);

  const collectionQuery: Record<string, unknown> = { _id: { $in: collectionIds } };
  if (search) {
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    collectionQuery.title = { $regex: escapedSearch, $options: "i" };
  }
  if (status === "active" || status === "draft") collectionQuery.status = status;
  if (type === "manual" || type === "automated") collectionQuery.collectionType = type;

  const collections = await Collection.find(collectionQuery)
    .select("title slug description image collectionType status publishing createdAt updatedAt")
    .lean();

  const rows: VendorCollectionRow[] = collections.map((collection) => ({
    _id: String(collection._id),
    title: collection.title,
    slug: collection.slug,
    description: collection.description,
    image: collection.image,
    collectionType: collection.collectionType,
    status: collection.status,
    productCount: countByCollection.get(String(collection._id)) || 0,
    publishing: {
      onlineStore: Boolean(collection.publishing?.onlineStore),
      pointOfSale: Boolean(collection.publishing?.pointOfSale),
    },
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
  }));

  const sortSelectors: Record<string, (row: VendorCollectionRow) => string | number> = {
    title: (row) => row.title,
    productCount: (row) => row.productCount,
    status: (row) => row.status,
    collectionType: (row) => row.collectionType,
    createdAt: (row) => (row.createdAt ? new Date(row.createdAt).getTime() : 0),
    updatedAt: (row) => (row.updatedAt ? new Date(row.updatedAt).getTime() : 0),
  };
  const getSortValue = sortSelectors[sortBy] || sortSelectors.title;
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
