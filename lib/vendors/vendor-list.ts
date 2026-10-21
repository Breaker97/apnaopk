import { User, Vendor } from "@/models";
import { connectDB } from "@/lib/db";
import { USER_ACCOUNT_STATUS } from "@/config/app.config";
import { resolveDateFilter } from "@/lib/date-filter";
import { getExternalVendorFilter } from "@/lib/vendors/multi-vendor";
import { getVendorSalesTotals } from "@/lib/vendors/vendor-sales";
import {
  countForQuery,
  listResult,
  type ListResult,
} from "@/lib/api/list-query";
import type { AdminVendorListFilters } from "@/lib/validations/list-query";

/**
 * Admin vendor list query.
 *
 * Shared by `GET /api/admin/vendors`, its CSV export and the vendors page's
 * server component so the endpoint, the file and the rendered page always
 * agree on what a given query string means.
 */

interface AdminVendorListParams extends AdminVendorListFilters {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sortOrder?: "asc" | "desc";
}

async function buildVendorListFilter(
  params: AdminVendorListParams,
): Promise<Record<string, unknown>> {
  const { search, status, date, account, verified, store, commission } = params;
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

  // The day the Joined column prints.
  const joinedWithin = resolveDateFilter(date);
  if (joinedWithin) {
    query.createdAt = { $gte: joinedWithin.from, $lte: joinedWithin.to };
  }

  // Both default to the permissive value on rows that predate the field.
  if (verified === "yes") query.verified = true;
  if (verified === "no") query.verified = { $ne: true };
  if (store === "open") query.storeActive = { $ne: false };
  if (store === "closed") query.storeActive = false;

  // An absent source is a default rate (see the model's `commissionSource`).
  if (commission === "default") {
    query.commissionSource = { $nin: ["plan", "manual"] };
  } else if (commission === "plan" || commission === "manual") {
    query.commissionSource = commission;
  }

  // The owner's login lives on the user, so the owners are read first — only
  // among the vendors every other filter kept, never across every account.
  if (account && account !== "all") {
    const ownerIds = await Vendor.distinct("userId", query);
    const ownerStatus =
      account === USER_ACCOUNT_STATUS.ACTIVE
        ? // An account with no status is an active one, as the Account column shows it.
          { $nin: [USER_ACCOUNT_STATUS.INACTIVE, USER_ACCOUNT_STATUS.BANNED] }
        : account;
    query.userId = {
      $in: await User.distinct("_id", { _id: { $in: ownerIds }, status: ownerStatus }),
    };
  }

  return query;
}

export async function fetchAdminVendorList(
  params: AdminVendorListParams,
): Promise<ListResult<unknown>> {
  await connectDB();

  const { page, limit, sortOrder } = params;
  const query = await buildVendorListFilter(params);

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
