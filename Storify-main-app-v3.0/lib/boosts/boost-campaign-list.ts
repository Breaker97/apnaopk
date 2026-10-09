import type { Types } from "mongoose";
import { BoostCampaign, Product, Vendor } from "@/models";
import { BOOST_CREDIT_OWED_TAB } from "@/config/app.config";
import { connectDB } from "@/lib/db";
import {
  countForQuery,
  listResult,
  type ListResult,
} from "@/lib/api/list-query";

/**
 * Boost campaign list query.
 *
 * Shared by `GET /api/admin/boosts/campaigns`, `the vendor and admin boost pages` and
 * the boosts pages' server components so every caller reads a query string
 * the same way (coupon-list pattern). The admin and vendor views differ only
 * in scope: pass `vendorId` to restrict the list to one seller's campaigns.
 */

interface BoostCampaignListParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  /** Admin only: narrow to one seller. Ignored when the context is a vendor. */
  vendor?: string;
  /** One ladder rung, by the number the booking was sold at. */
  position?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/**
 * Column id -> the field it actually sorts on. A whitelist, not a passthrough:
 * `sortBy` arrives from the query string, and an unindexed or nonexistent path
 * is a full collection scan at best.
 */
const SORTABLE_FIELDS: Record<string, string> = {
  createdAt: "createdAt",
  position: "positionSnapshot.position",
  amount: "amount",
  credit: "refundableAmount",
  status: "status",
  window: "startDay",
  impressions: "totalImpressions",
};

/** Bounds the `$in` a name search builds. */
const SEARCH_MATCH_CAP = 200;

interface BoostCampaignListContext {
  /** Present for the vendor dashboard; absent lists every campaign. */
  vendorId?: Types.ObjectId | string;
}

export interface BoostCampaignListRow {
  _id: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  /**
   * The booking's own UTC calendar bounds. Carried alongside the instants so no
   * surface re-derives a day by formatting `startsAt` in the browser's
   * timezone, which prints the wrong start date for roughly half the planet.
   */
  startDay: string;
  endDay: string;
  billedDays: number;
  provider: string | null;
  amount: number;
  currency: string;
  paidAt: string | null;
  cancelReason: string | null;
  refundableAmount: number;
  totalImpressions: number;
  totalClicks: number;
  createdAt: string;
  positionSnapshot: {
    position: number;
    label: string;
    pricePerDay: number;
    currency: string;
  };
  product: { _id: string; name: string; slug: string; image: string | null } | null;
  vendor: { _id: string; storeName: string } | null;
}

async function buildBoostCampaignListFilter(
  {
    search,
    status,
    vendor,
    position,
  }: Pick<BoostCampaignListParams, "search" | "status" | "vendor" | "position">,
  { vendorId }: BoostCampaignListContext = {},
): Promise<Record<string, unknown>> {
  const query: Record<string, unknown> = {};

  if (vendorId) query.vendorId = vendorId;
  else if (vendor && vendor !== "all") query.vendorId = vendor;

  // The ladder's "View bookings" lands here. The snapshot, not the live rung:
  // a booking belongs to the number it was sold at, even after that rung was
  // deleted and its number reused.
  const rung = Number(position);
  if (position && position !== "all" && Number.isInteger(rung) && rung > 0) {
    query["positionSnapshot.position"] = rung;
  }

  // The tab that is not a status: everything with an unsettled obligation,
  // whatever state it ended in. A credit outlives the booking that created it
  // — most sit on cancelled and expired rows — so no status filter can find
  // them, and it is the one queue here that costs the marketplace money for as
  // long as it goes unseen.
  if (status === BOOST_CREDIT_OWED_TAB) query.refundableAmount = { $gt: 0 };
  else if (status && status !== "all") query.status = status;

  // `search` arrives regex-escaped from SafeSearchSchema. It matches the frozen
  // rung label, and — when the query is a bare integer — the rung number too:
  // typing "2" must find Position 2, which is how anyone actually refers to a
  // booking.
  //
  // Product and store names live on other collections, so they are resolved to
  // ids first and matched by `$in`. That is two extra capped queries, and it is
  // what makes the search answer the question the screen actually asks: the
  // product and the seller are both COLUMNS here, and a table you cannot search
  // by its own columns sends an admin to the database instead.
  if (search) {
    const or: Record<string, unknown>[] = [
      { "positionSnapshot.label": { $regex: search, $options: "i" } },
    ];
    const asNumber = Number(search);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      or.push({ "positionSnapshot.position": asNumber });
    }

    const [products, vendors] = await Promise.all([
      Product.find({
        name: { $regex: search, $options: "i" },
        ...(vendorId ? { vendorId } : {}),
      })
        .select("_id")
        .limit(SEARCH_MATCH_CAP)
        .lean<Array<{ _id: Types.ObjectId }>>(),
      // A vendor looking at their own list has one store name, and it is the
      // one on every row: searching it would match everything or nothing.
      vendorId
        ? Promise.resolve([])
        : Vendor.find({ storeName: { $regex: search, $options: "i" } })
            .select("_id")
            .limit(SEARCH_MATCH_CAP)
            .lean<Array<{ _id: Types.ObjectId }>>(),
    ]);

    if (products.length > 0) {
      or.push({ productId: { $in: products.map((row) => row._id) } });
    }
    if (vendors.length > 0) {
      or.push({ vendorId: { $in: vendors.map((row) => row._id) } });
    }
    query.$or = or;
  }

  return query;
}

type PopulatedCampaign = {
  _id: unknown;
  status: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  startDay?: string;
  endDay?: string;
  billedDays?: number;
  provider?: string | null;
  amount: number;
  currency: string;
  paidAt?: Date | null;
  cancelReason?: string | null;
  refundableAmount?: number;
  totalImpressions?: number;
  totalClicks?: number;
  createdAt: Date;
  positionSnapshot?: {
    position: number;
    label: string;
    pricePerDay: number;
    currency: string;
  } | null;
  productId?: {
    _id: unknown;
    name?: string;
    slug?: string;
    images?: string[];
  } | null;
  vendorId?: { _id: unknown; storeName?: string } | null;
};

function serializeRow(row: PopulatedCampaign): BoostCampaignListRow {
  return {
    _id: String(row._id),
    status: row.status,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    startDay: row.startDay ?? "",
    endDay: row.endDay ?? "",
    billedDays: row.billedDays ?? 0,
    provider: row.provider ?? null,
    amount: row.amount,
    currency: row.currency,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    cancelReason: row.cancelReason ?? null,
    refundableAmount: row.refundableAmount ?? 0,
    totalImpressions: row.totalImpressions ?? 0,
    totalClicks: row.totalClicks ?? 0,
    createdAt: row.createdAt.toISOString(),
    positionSnapshot: row.positionSnapshot ?? {
      position: 0,
      label: "",
      pricePerDay: 0,
      currency: row.currency,
    },
    product: row.productId
      ? {
          _id: String(row.productId._id),
          name: row.productId.name || "",
          slug: row.productId.slug || "",
          image: row.productId.images?.[0] || null,
        }
      : null,
    vendor: row.vendorId
      ? {
          _id: String(row.vendorId._id),
          storeName: row.vendorId.storeName || "",
        }
      : null,
  };
}

export async function fetchBoostCampaignList(
  params: BoostCampaignListParams,
  context: BoostCampaignListContext = {},
): Promise<ListResult<BoostCampaignListRow>> {
  await connectDB();

  const { page, limit } = params;
  const query = await buildBoostCampaignListFilter(params, context);
  const sortField = SORTABLE_FIELDS[params.sortBy ?? ""] ?? "createdAt";
  const direction = params.sortOrder === "asc" ? 1 : -1;

  const [campaigns, total] = await Promise.all([
    BoostCampaign.find(query)
      // `_id` breaks every tie: without it two rows with the same amount can
      // swap places between pages and one of them is never shown.
      .sort({ [sortField]: direction, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("productId", "name slug images")
      .populate("vendorId", "storeName")
      .lean<PopulatedCampaign[]>(),
    countForQuery(BoostCampaign, query),
  ]);

  return listResult(campaigns.map(serializeRow), page, limit, total);
}
