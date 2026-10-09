import { Types } from "mongoose";
import { BOOST_CAMPAIGN_STATUS, BOOST_PLACEMENT } from "@/config/app.config";
import { utcDay } from "@/lib/boosts/boost-days";
import { BoostCampaign, BoostMetricDaily } from "@/models";

/**
 * Impressions and clicks of paid placements, counted for the vendors who paid
 * for them: the storefront's beacon (POST /api/track/sponsored) and the
 * shopper app (POST /api/mobile/shop/v1/{locale}/events/sponsored) both
 * record through here.
 *
 * What is sold is a position for a range of days, so these counts are
 * reporting-grade (the vendor's return on money spent) and nothing is billed
 * on them. Counts are $inc'd into one daily bucket per (campaign, day,
 * placement) plus lifetime totals on the campaign — bounded growth, cheap
 * aggregation. Only a campaign running now is counted.
 */

export type SponsoredPlacement = (typeof BOOST_PLACEMENT)[keyof typeof BOOST_PLACEMENT];

export const SPONSORED_PLACEMENT_VALUES = [
  BOOST_PLACEMENT.HOME,
  BOOST_PLACEMENT.LISTING,
  BOOST_PLACEMENT.PRODUCT_PAGE,
] as const;

interface SponsoredEvent {
  /** A campaign id, 24 hex characters (validated by the caller). */
  campaignId: string;
  placement: SponsoredPlacement;
  type: "imp" | "clk";
}

/** At most this many events in one batch. */
export const MAX_SPONSORED_EVENTS = 50;

/** A 24-hex campaign id: `new Types.ObjectId` can never throw on it. */
export const CAMPAIGN_ID = /^[0-9a-fA-F]{24}$/;

/**
 * Count a batch. Answers how many of its events were counted (the others
 * named a campaign that is not running). A failed write is logged, not
 * thrown: a beacon never fails the screen that sent it.
 */
export async function recordSponsoredEvents(events: SponsoredEvent[]): Promise<number> {
  const campaignIds = [...new Set(events.map((event) => event.campaignId))];
  if (campaignIds.length === 0) return 0;
  const activeCampaigns = await BoostCampaign.find({
    _id: { $in: campaignIds.map((id) => new Types.ObjectId(id)) },
    status: BOOST_CAMPAIGN_STATUS.ACTIVE,
  })
    .select("vendorId productId")
    .lean<
      Array<{
        _id: unknown;
        vendorId: Types.ObjectId;
        productId: Types.ObjectId;
      }>
    >();
  const activeById = new Map(activeCampaigns.map((c) => [String(c._id), c]));

  // Collapse the batch to one $inc per (campaign, placement) pair.
  const counters = new Map<
    string,
    { campaignId: string; placement: SponsoredPlacement; imp: number; clk: number }
  >();
  let counted = 0;
  for (const event of events) {
    if (!activeById.has(event.campaignId)) continue;
    counted += 1;
    const key = `${event.campaignId}:${event.placement}`;
    const entry =
      counters.get(key) ??
      ({ campaignId: event.campaignId, placement: event.placement, imp: 0, clk: 0 } as const);
    const next = { ...entry };
    if (event.type === "imp") next.imp += 1;
    else next.clk += 1;
    counters.set(key, next);
  }
  if (counters.size === 0) return 0;

  const date = utcDay(new Date());
  const bucketOps = [...counters.values()].map((entry) => {
    const campaign = activeById.get(entry.campaignId)!;
    return {
      updateOne: {
        filter: {
          campaignId: new Types.ObjectId(entry.campaignId),
          date,
          placement: entry.placement,
        },
        update: {
          $inc: { impressions: entry.imp, clicks: entry.clk },
          $setOnInsert: {
            vendorId: campaign.vendorId,
            productId: campaign.productId,
          },
        },
        upsert: true,
      },
    };
  });

  const totals = new Map<string, { imp: number; clk: number }>();
  for (const entry of counters.values()) {
    const sum = totals.get(entry.campaignId) ?? { imp: 0, clk: 0 };
    sum.imp += entry.imp;
    sum.clk += entry.clk;
    totals.set(entry.campaignId, sum);
  }
  const totalOps = [...totals.entries()].map(([campaignId, sum]) => ({
    updateOne: {
      filter: { _id: new Types.ObjectId(campaignId) },
      update: {
        $inc: { totalImpressions: sum.imp, totalClicks: sum.clk },
      },
    },
  }));

  // Concurrent first-writes to the same daily bucket can race the upsert into
  // one E11000 loser; a single immediate retry lands its $inc on the
  // now-existing row.
  //
  // Retry ONLY the operations that failed. With `ordered: false` the driver
  // runs every op and then reports the failures together, so the ones that
  // succeeded have already been applied — replaying the whole batch would
  // $inc them a second time and inflate the very counters vendors are shown
  // as the return on money they spent.
  const writeBuckets = async (ops: typeof bucketOps) => {
    if (ops.length === 0) return;
    try {
      await BoostMetricDaily.bulkWrite(ops, { ordered: false });
    } catch (error) {
      const writeErrors = (error as { writeErrors?: Array<{ index?: number }> })
        .writeErrors;
      const retryable = (writeErrors ?? [])
        .map((writeError) => ops[writeError.index ?? -1])
        .filter(Boolean);
      // No per-op detail means we cannot tell what landed — surface it rather
      // than guess, since guessing wrong double-counts.
      if (retryable.length === 0) throw error;
      await BoostMetricDaily.bulkWrite(retryable, { ordered: false });
    }
  };
  await Promise.all([
    writeBuckets(bucketOps),
    BoostCampaign.bulkWrite(totalOps, { ordered: false }),
  ]).catch((error) => {
    console.error("Failed to record sponsored metrics:", error);
  });
  return counted;
}
