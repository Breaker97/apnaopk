import { STAFF_PERMISSIONS } from "@/config/permissions.config";
import { assertUnscopedStaff } from "@/lib/access/staff-authz";
import { withApi } from "@/lib/api/handler";
import { successResponse } from "@/lib/api/response";
import { connectDB } from "@/lib/db";
import { Coupon } from "@/models";
import { CouponStatus, MERCHANT_COUPON_FILTER } from "@/models/coupon.model";

/**
 * The discounts a platform Campaign Banner may advertise: the store's own
 * active ones. Its own route because the Discounts list is admin-only (staff
 * who may manage banners would see an empty picker) and lists every seller's
 * codes, which a banner for the whole store cannot promote — saving one is
 * refused (`assertCoupon` in lib/campaign-banners/service.ts).
 */
export const GET = withApi(
  {
    auth: "admin-or-staff",
    staffPermissions: [STAFF_PERMISSIONS.VIEW_CAMPAIGN_BANNERS],
  },
  async ({ staff }) => {
    assertUnscopedStaff(
      staff?.scope,
      "Campaign banners are managed for the whole store",
    );
    await connectDB();
    // `vendorId: null` is "the store's own": a coupon without a seller. A
    // coupon can read "active" long after its end date; the shop would hide
    // the banner at once, so the picker does not offer it.
    const filter: Record<string, unknown> = {
      ...MERCHANT_COUPON_FILTER,
      vendorId: null,
      status: CouponStatus.ACTIVE,
      endDate: { $gte: new Date() },
    };
    const items = await Coupon.find(filter)
      .select("code label type value")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return successResponse(items);
  },
);
