import { VENDOR_PERMISSIONS } from "@/config/permissions.config";
import { BOOST_CAMPAIGN_STATUS, BOOST_CANCEL_REASON } from "@/config/app.config";
import { assertVendorPermission } from "@/lib/access/rbac";
import { requireApprovedVendorByUserId } from "@/lib/access/vendor-guard";
import { ValidationError } from "@/lib/api/errors";
import { successResponse, notFoundResponse } from "@/lib/api/response";
import { isValidObjectId } from "@/lib/api/validate";
import { withApi } from "@/lib/api/handler";
import { BoostCampaign } from "@/models";
import { assertBoostingEnabled, cancelBoostCampaign } from "@/lib/boosts/boosts";

type RouteParams = { id: string };

/**
 * DELETE /api/vendor/boosts/campaigns/[id]
 * Cancel a booking that has not started yet.
 *
 * Restricted to `scheduled`. An `active` booking is mid-flight — part of it has
 * already rendered — and letting a vendor pull it themselves turns every
 * disappointing day into a self-service refund dispute; those go through the
 * marketplace.
 *
 * The reason this exists at all: bookings run up to 60 days out on a per-day
 * refund basis, so "email support to cancel" leaves the marketplace sitting on
 * inventory it cannot resell until a human intervenes. Cancelling here puts
 * every booked day straight back on the calendar.
 */
export const DELETE = withApi<RouteParams>(
  {
    auth: "user",
    rateLimit: { action: "vendor:boosts:cancel", preset: "moderate" },
    demo: "block-mutations",
  },
  async ({ params, session }) => {
    const user = session.user;
    await assertVendorPermission(
      user,
      VENDOR_PERMISSIONS.MANAGE_BOOSTS,
      "You do not have permission to manage boosts",
    );

    await assertBoostingEnabled();
    const { id } = params;
    if (!isValidObjectId(id)) return notFoundResponse("Boost campaign");
    const vendor = await requireApprovedVendorByUserId(session.user.id);

    // Ownership is part of the lookup, so another vendor's id is a 404 rather
    // than a 403 that confirms the booking exists.
    const campaign = await BoostCampaign.findOne({
      _id: id,
      vendorId: vendor._id,
    })
      .select("status")
      .lean<{ status?: string } | null>();
    if (!campaign) return notFoundResponse("Boost campaign");

    if (campaign.status !== BOOST_CAMPAIGN_STATUS.SCHEDULED) {
      throw new ValidationError(
        campaign.status === BOOST_CAMPAIGN_STATUS.ACTIVE
          ? "This boost is already running. Contact the marketplace to stop it early."
          : "Only upcoming bookings can be canceled",
      );
    }

    const canceled = await cancelBoostCampaign(id, BOOST_CANCEL_REASON.VENDOR);
    if (!canceled) {
      throw new ValidationError("This booking can no longer be canceled");
    }

    return successResponse(
      { _id: String(canceled._id), status: canceled.status },
      "Booking canceled",
    );
  },
);
