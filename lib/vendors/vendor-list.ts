import { Vendor } from "@/models";
import { connectDB } from "@/lib/db";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { getVendorSalesTotals } from "@/lib/vendors/vendor-sales";
import {
  countForQuery,
  listResult,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Admin vendor list query.
 *
 * Shared by `GET /api/admin/vendors` and the vendors page's server component
 * so the endpoint and the rendered page always agree on what a given query
 * string means.
 */

interface AdminVendorListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortOrder?: "asc" | "desc";
}

function buildVendorListFilter({
  search,
  status,
}: Pick<AdminVendorListParams, "search" | "status">): Record<string, unknown> {
  // Excludes the store's own default vendor row, which is bookkeeping rather
  // than a real marketplace seller.
  const query: Record<string, unknown> = getExternalVendorFilter();

  // `search` arrives regex-escaped from SafeSearchSchema.
  if (search) {
    query.$or = [
      { storeName: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
    ];
  }

  if (status && status !== "all") query.status = status;

  return query;
}

export async function fetchAdminVendorList(
  params: AdminVendorListParams,
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, sortOrder } = params;
  const query = buildVendorListFilter(params);

  const [vendors, total] = await Promise.all([
    Vendor.find(query)
      .populate("user", "name email image status")
      .sort({ createdAt: sortOrder === "asc" ? 1 : -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    countForQuery(Vendor, query),
  ]);

  // The stored `totalSales` column is never written by the order flow, so the
  // page of rows gets its sales figures aggregated from orders instead.
  const rows = vendors as Array<Record<string, unknown> & { _id: unknown }>;
  const salesTotals = await getVendorSalesTotals(
    rows.map((row) => String(row._id)),
  );
  for (const row of rows) {
    row.totalSales = salesTotals.get(String(row._id)) ?? 0;
  }

  return listResult(rows as unknown[], page, limit, total);
}
