import type { Types } from "mongoose";
import { BoostCampaign } from "@/models";
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
}

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

function buildBoostCampaignListFilter(
  { search, status }: Pick<BoostCampaignListParams, "search" | "status">,
  { vendorId }: BoostCampaignListContext = {},
): Record<string, unknown> {
  const query: Record<string, unknown> = {};

  if (vendorId) query.vendorId = vendorId;
  if (status && status !== "all") query.status = status;

  // `search` arrives regex-escaped from SafeSearchSchema. It matches the frozen
  // rung label, and — when the query is a bare integer — the rung number too:
  // typing "2" must find Position 2, which is how anyone actually refers to a
  // booking. Product names are deliberately NOT searched — they live on another
  // collection and the UI says "position or label" rather than implying they
  // are.
  if (search) {
    const or: Record<string, unknown>[] = [
      { "positionSnapshot.label": { $regex: search, $options: "i" } },
    ];
    const asNumber = Number(search);
    if (Number.isInteger(asNumber) && asNumber > 0) {
      or.push({ "positionSnapshot.position": asNumber });
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
  const query = buildBoostCampaignListFilter(params, context);

  const [campaigns, total] = await Promise.all([
    BoostCampaign.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("productId", "name slug images")
      .populate("vendorId", "storeName")
      .lean<PopulatedCampaign[]>(),
    countForQuery(BoostCampaign, query),
  ]);

  return listResult(campaigns.map(serializeRow), page, limit, total);
}
