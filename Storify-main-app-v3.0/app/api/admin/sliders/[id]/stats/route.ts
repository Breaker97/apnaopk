import { Slider, SliderMetricDaily } from "@/models";
import { successResponse } from "@/lib/api/response";
import { NotFoundError } from "@/lib/api/errors";
import { withApi } from "@/lib/api/handler";
import { utcDay } from "@/lib/boosts/boost-days";
import { getSliderLookup } from "../route";

export interface SliderStats {
  /** The window the counts cover, in days. */
  days: number;
  /** Per slide id: views and button/slide clicks. */
  slides: Record<string, { impressions: number; clicks: number }>;
  totals: { impressions: number; clicks: number };
}

/**
 * GET /api/admin/sliders/[id]/stats?days=30 — which slide earns its place:
 * impressions and clicks per slide over the window, from the daily buckets
 * the storefront beacon fills.
 */
export const GET = withApi<{ id: string }>(
  { auth: "admin" },
  async ({ request, params }) => {
    const slider = await Slider.findOne(getSliderLookup(params.id))
      .select("handle")
      .lean();
    if (!slider) throw new NotFoundError("Slider");
    const requested = Number(request.nextUrl.searchParams.get("days"));
    const days = Number.isFinite(requested) && requested > 0 ? Math.min(365, Math.round(requested)) : 30;
    const since = utcDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
    const rows = await SliderMetricDaily.aggregate<{
      _id: string;
      impressions: number;
      clicks: number;
    }>([
      { $match: { handle: slider.handle, date: { $gte: since } } },
      {
        $group: {
          _id: "$slideId",
          impressions: { $sum: "$impressions" },
          clicks: { $sum: "$clicks" },
        },
      },
    ]);
    const stats: SliderStats = { days, slides: {}, totals: { impressions: 0, clicks: 0 } };
    for (const row of rows) {
      stats.slides[row._id] = { impressions: row.impressions, clicks: row.clicks };
      stats.totals.impressions += row.impressions;
      stats.totals.clicks += row.clicks;
    }
    return successResponse(stats);
  },
);
