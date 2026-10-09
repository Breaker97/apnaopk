import { BoostCampaign, BoostPosition } from "@/models";
import { getSettings } from "@/models/settings.model";
import { connectDB } from "@/lib/db";
import { successResponse } from "@/lib/api/response";
import { withApi } from "@/lib/api/handler";
import {
  BOOST_CAMPAIGN_STATUS,
  BOOST_POSITION_STATUS,
} from "@/config/app.config";
import { getSponsoredPlacementDepths } from "@/lib/boosts/sponsored-products";
import type { BoostingOverview } from "@/lib/boosts/boosting-overview";

/**
 * GET /api/admin/boosts/overview
 * What Settings → Product Boosting shows beside its own fields: the ladder on
 * sale, how deep each page renders it today, and the paid bookings that would
 * stop showing if boosting were switched off.
 *
 * Not gated on `boosting.enabled`, unlike the ladder and campaign endpoints:
 * the settings screen asks while the switch is being turned on, before that is
 * saved, and a ladder built earlier is what it has to show.
 */
export const GET = withApi(
  {
    auth: "admin",
    rateLimit: { action: "admin:boosts:overview", preset: "lenient" },
  },
  async () => {
    await connectDB();
    const [settings, positions, depths, running, upcoming] = await Promise.all([
      getSettings(),
      BoostPosition.find({ status: BOOST_POSITION_STATUS.ACTIVE })
        .sort({ position: 1 })
        .select("position label pricePerDay currency")
        .lean(),
      getSponsoredPlacementDepths(),
      BoostCampaign.countDocuments({ status: BOOST_CAMPAIGN_STATUS.ACTIVE }),
      BoostCampaign.countDocuments({ status: BOOST_CAMPAIGN_STATUS.SCHEDULED }),
    ]);

    const overview: BoostingOverview = {
      currency: (settings.general?.defaultCurrency || "USD").toUpperCase(),
      positions: positions.map((row) => ({
        position: row.position,
        label: row.label,
        pricePerDay: row.pricePerDay ?? 0,
        currency: row.currency,
      })),
      depths,
      bookings: { running, upcoming },
    };
    return successResponse(overview);
  },
);
