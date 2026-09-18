import { Types } from "mongoose";
import { BoostMetricDaily } from "@/models";
import { connectDB } from "@/lib/db";
import { utcDay } from "@/lib/boosts/boost-days";

interface BoostDayPoint {
  date: string;
  impressions: number;
  clicks: number;
}

interface BoostPlacementPoint {
  placement: string;
  impressions: number;
  clicks: number;
}

export interface BoostCampaignStats {
  totals: { impressions: number; clicks: number; ctr: number };
  byDay: BoostDayPoint[];
  byPlacement: BoostPlacementPoint[];
}

/**
 * Day-bucket + placement aggregation for one campaign, shared by the vendor
 * and admin stats routes.
 * Buckets are keyed by UTC "YYYY-MM-DD" strings, so grouping is a plain
 * string group — no $dateToString needed.
 */
export async function getBoostCampaignStats(
  campaignId: string,
  days = 30,
): Promise<BoostCampaignStats> {
  await connectDB();

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const match = {
    campaignId: new Types.ObjectId(campaignId),
    date: { $gte: utcDay(since) },
  };

  const [facets] = await BoostMetricDaily.aggregate<{
    byDay: Array<{ _id: string; impressions: number; clicks: number }>;
    byPlacement: Array<{ _id: string; impressions: number; clicks: number }>;
    totals: Array<{ impressions: number; clicks: number }>;
  }>([
    { $match: match },
    {
      $facet: {
        byDay: [
          {
            $group: {
              _id: "$date",
              impressions: { $sum: "$impressions" },
              clicks: { $sum: "$clicks" },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byPlacement: [
          {
            $group: {
              _id: "$placement",
              impressions: { $sum: "$impressions" },
              clicks: { $sum: "$clicks" },
            },
          },
        ],
        totals: [
          {
            $group: {
              _id: null,
              impressions: { $sum: "$impressions" },
              clicks: { $sum: "$clicks" },
            },
          },
        ],
      },
    },
  ]);

  const impressions = facets?.totals?.[0]?.impressions ?? 0;
  const clicks = facets?.totals?.[0]?.clicks ?? 0;

  return {
    totals: {
      impressions,
      clicks,
      // Clamped for the same reason as the list view: session-deduped
      // impressions against per-pageview clicks can exceed 1.
      ctr: impressions > 0 ? Math.min(1, clicks / impressions) : 0,
    },
    byDay: (facets?.byDay ?? []).map((row) => ({
      date: row._id,
      impressions: row.impressions,
      clicks: row.clicks,
    })),
    byPlacement: (facets?.byPlacement ?? []).map((row) => ({
      placement: row._id,
      impressions: row.impressions,
      clicks: row.clicks,
    })),
  };
}
