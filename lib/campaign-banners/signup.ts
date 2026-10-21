import "server-only";

import {
  MARKETING_CONSENT_SOURCE,
  MARKETING_CONSENT_STATE,
  MARKETING_OPT_IN_LEVEL,
} from "@/config/app.config";
import { NotFoundError } from "@/lib/api/errors";
import { afterResponse } from "@/lib/after-response";
import { connectDB, mongoose } from "@/lib/db";
import {
  isMarketingSuppressed,
  setMarketingConsent,
} from "@/lib/customers/marketing-consent";
import { getStorefrontCoupon, isCouponLive } from "@/lib/storefront/storefront-coupon";
import { CampaignBanner } from "@/models/campaign-banner.model";
import { getSettings } from "@/models/settings.model";
import {
  campaignBannerAsShown,
  campaignBannerState,
  toCampaignBanner,
} from "./types";

/**
 * A visitor types their email into a Campaign Banner.
 *
 * Only the marketplace's own banners collect it — consent is platform-wide,
 * there is no per-vendor list to put it on — and only while the banner is
 * live with its form switched on; anything else reads as "no such banner", so
 * the endpoint cannot be used to probe drafts.
 *
 * The visitor is asked to confirm by email (double opt-in): they land
 * `pending`, mailed once on the way in, and become a subscriber only when
 * they open the link — the same path the checkout box takes. The code is
 * shown straight away; it is a discount, not a reward for confirming.
 */
export async function signUpThroughCampaignBanner(params: {
  bannerId: string;
  email: string;
  /** The signed-in customer, when the typed address is their own. */
  userId?: string | null;
  ip?: string | null;
  locale?: string;
}): Promise<{ couponCode: string }> {
  if (!mongoose.isValidObjectId(params.bannerId)) {
    throw new NotFoundError("Campaign banner");
  }
  await connectDB();
  const doc = await CampaignBanner.findOne({
    _id: params.bannerId,
    vendorId: null,
    status: "active",
  }).lean();
  // As shown: a picture-only popup has no form, whatever was left switched on.
  const banner = doc ? campaignBannerAsShown(toCampaignBanner(doc)) : null;
  if (
    !banner ||
    !banner.signup.enabled ||
    campaignBannerState(banner, new Date()) !== "live"
  ) {
    throw new NotFoundError("Campaign banner");
  }

  // An address the mail server rejected, or that reported us as spam, is not
  // written to or mailed again; the visitor still gets what the banner offered.
  if (!(await isMarketingSuppressed(params.email))) {
    const consent = await setMarketingConsent({
      state: MARKETING_CONSENT_STATE.PENDING,
      optInLevel: MARKETING_OPT_IN_LEVEL.CONFIRMED,
      source: MARKETING_CONSENT_SOURCE.STOREFRONT_FORM,
      userId: params.userId,
      guestEmail: params.userId ? null : params.email,
      ip: params.ip,
      createIfMissing: true,
    });

    // Owed once, on the way INTO pending: someone already on the list is left
    // there, and someone still pending already holds a working link.
    if (
      consent.state === MARKETING_CONSENT_STATE.PENDING &&
      consent.previousState !== MARKETING_CONSENT_STATE.PENDING
    ) {
      const { email, locale } = params;
      afterResponse(async () => {
        const [{ sendMarketingConfirmationEmail }, settings] = await Promise.all([
          import("@/lib/customers/marketing-confirmation"),
          getSettings(),
        ]);
        await sendMarketingConfirmationEmail({ email, settings, locale });
      });
    }
  }

  let couponCode = "";
  if (banner.couponCode) {
    const coupon = await getStorefrontCoupon(banner.couponCode);
    if (coupon && isCouponLive(coupon)) couponCode = coupon.code;
  }
  return { couponCode };
}
