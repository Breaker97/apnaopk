import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import {
  BOOST_POSITION_STATUS,
  BOOST_HOLD_MAX_MINUTES,
  BOOST_HOLD_MIN_MINUTES,
} from "@/config/app.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { successResponse } from "@/lib/api/response";
import { rateLimitByUser } from "@/lib/api/rate-limit-middleware";
import { withApi } from "@/lib/api/handler";
import { BoostCampaign, BoostPosition } from "@/models";
import { NON_TERMINAL_BOOST_CAMPAIGN_STATUSES } from "@/models/boostCampaign.model";
import { assertBoostingEnabled, getPositionDeliveryAverages } from "@/lib/boosts/boosts";
import {
  getPositionVisibility,
  isPositionUnreachable,
} from "@/lib/boosts/boost-placement-depths";
import { getSponsoredPlacementDepths } from "@/lib/boosts/sponsored-products";
import { resolvePlatformPaymentMethods } from "@/lib/payments/platform-payments";

/**
 * GET /api/vendor/boosts/catalog
 *
 * The STATIC half of the purchase dialog: the ladder, its prices, what each
 * rung reaches, and the booking rules. Fetched once when the dialog opens.
 *
 * Nothing here changes while a vendor picks dates, which is the whole reason it
 * is split from `/availability`: that endpoint is refetched on open, on focus
 * and again before submit, and duplicating the prices into it would ship them
 * four times a session and let two copies of one price disagree inside a single
 * dialog.
 */
export const GET = withApi({ auth: "user" }, async ({ request, session }) => {
  const user = session.user;
  await assertVendorPermission(
    user,
    VENDOR_PERMISSIONS.VIEW_BOOSTS,
    "You do not have permission to view boosts",
  );

  await rateLimitByUser(
    request,
    session.user.id,
    "vendor:boosts:catalog",
    "lenient",
    session.user.role,
  );

  const settings = await assertBoostingEnabled();
  const vendor = await requireApprovedVendorByUserId(session.user.id);

  const [positions, depths, delivery, bookings] = await Promise.all([
    BoostPosition.find({ status: BOOST_POSITION_STATUS.ACTIVE })
      .sort({ position: 1 })
      .select("position label description pricePerDay currency")
      .lean<
        Array<{
          position: number;
          label: string;
          description?: string;
          pricePerDay: number;
          currency?: string;
        }>
      >(),
    getSponsoredPlacementDepths(),
    getPositionDeliveryAverages(),
    // How many bookings each of this vendor's products already carries. Purely
    // informative — a product may legitimately hold this week's Position 1 and
    // next month's Position 2, so this never blocks a pick. It replaces the old
    // `boostedProductIds` hide-list, which the ladder makes wrong.
    BoostCampaign.aggregate<{ _id: unknown; count: number }>([
      {
        $match: {
          vendorId: vendor._id,
          status: { $in: NON_TERMINAL_BOOST_CAMPAIGN_STATUSES },
        },
      },
      { $group: { _id: "$productId", count: { $sum: 1 } } },
    ]),
  ]);

  const currency = (settings.general?.defaultCurrency || "USD").toUpperCase();
  const boosting = settings.boosting;

  const bookingCountByProduct: Record<string, number> = {};
  for (const row of bookings) {
    if (row._id) bookingCountByProduct[String(row._id)] = row.count;
  }

  return successResponse({
    currency,
    paymentMethods: resolvePlatformPaymentMethods(
      settings,
      boosting?.paymentMethods,
    ),
    positions: positions
      // A rung deeper than every placement renders nowhere. Selling one takes
      // the money for a whole booking that shows on no page, so it is withheld
      // from the vendor entirely; the admin ladder flags it for repair.
      .filter((row) => !isPositionUnreachable(row.position, depths))
      .map((row) => ({
        position: row.position,
        label: row.label,
        description: row.description || "",
        pricePerDay: row.pricePerDay,
        // Priced in a currency the store no longer uses: checkout refuses this
        // rung outright, so say so before the vendor picks dates for it.
        stale: Boolean(row.currency && row.currency.toUpperCase() !== currency),
        reach: getPositionVisibility(row.position, depths),
        avgImpressionsPerDay: delivery[row.position] ?? null,
      })),
    placementDepth: depths,
    placementsEnabled: {
      home: boosting?.placements?.home !== false,
      listing: boosting?.placements?.listing !== false,
      productPage: boosting?.placements?.productPage !== false,
    },
    bookingHorizonDays: boosting?.bookingHorizonDays ?? 60,
    maxBookingDays: boosting?.maxBookingDays ?? 60,
    holdMinutes: Math.min(
      BOOST_HOLD_MAX_MINUTES,
      Math.max(BOOST_HOLD_MIN_MINUTES, boosting?.holdMinutes ?? 45),
    ),
    bookingCountByProduct,
  });
});
