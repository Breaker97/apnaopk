import { z } from "zod";
import { Types } from "mongoose";
import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/handler";
import { utcDay } from "@/lib/boosts/boost-days";
import { BoostCampaign, BoostMetricDaily } from "@/models";
import {
  BOOST_CAMPAIGN_STATUS,
  BOOST_PLACEMENT,
} from "@/config/app.config";

const EventSchema = z.object({
  /** campaignId — hex-validated so ObjectId construction can never throw
   * (a 24-char non-hex string would break the always-204 contract). */
  c: z.string().regex(/^[0-9a-fA-F]{24}$/),
  /** placement */
  p: z.enum([
    BOOST_PLACEMENT.HOME,
    BOOST_PLACEMENT.LISTING,
    BOOST_PLACEMENT.PRODUCT_PAGE,
  ]),
  /** type */
  t: z.enum(["imp", "clk"]),
});

const PayloadSchema = z.object({
  events: z.array(EventSchema).min(1).max(50),
});

// Obvious automation only. What is sold is a position for a range of days, so
// these counts are reporting-grade (vendor ROI) and nothing is billed on them —
// heavier fraud defenses belong to a CPC model.
const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|pingdom|curl|wget|python-requests/i;

/**
 * POST /api/track/sponsored
 * Impression/click beacon for sponsored placements. Fire-and-forget by
 * contract: always 204, never an error the client would surface. Counts are
 * $inc'd into one daily bucket per (campaign, day, placement) plus lifetime
 * totals on the campaign — bounded growth, cheap aggregation. Server-side on
 * purpose: ad blockers eat client analytics, and vendors are shown these
 * numbers as the return on money they paid.
 */
export const POST = withApi(
  {
    auth: "optional",
    rateLimit: { action: "track:sponsored", preset: "lenient" },
  },
  async ({ request }) => {
    const userAgent = request.headers.get("user-agent") || "";
    if (!userAgent || BOT_UA.test(userAgent)) {
      return new NextResponse(null, { status: 204 });
    }

    const body = await request.json().catch(() => null);
    const parsed = PayloadSchema.safeParse(body);
    if (!parsed.success) {
      return new NextResponse(null, { status: 204 });
    }

    const campaignIds = [...new Set(parsed.data.events.map((e) => e.c))];
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
    const activeById = new Map(
      activeCampaigns.map((c) => [String(c._id), c]),
    );

    // Collapse the batch to one $inc per (campaign, placement) pair.
    type Placement = (typeof BOOST_PLACEMENT)[keyof typeof BOOST_PLACEMENT];
    const counters = new Map<
      string,
      { campaignId: string; placement: Placement; imp: number; clk: number }
    >();
    for (const event of parsed.data.events) {
      if (!activeById.has(event.c)) continue;
      const key = `${event.c}:${event.p}`;
      const entry =
        counters.get(key) ??
        ({ campaignId: event.c, placement: event.p, imp: 0, clk: 0 } as const);
      const next = { ...entry };
      if (event.t === "imp") next.imp += 1;
      else next.clk += 1;
      counters.set(key, next);
    }
    if (counters.size === 0) return new NextResponse(null, { status: 204 });

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

    return new NextResponse(null, { status: 204 });
  },
);
