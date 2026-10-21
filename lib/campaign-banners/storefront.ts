import "server-only";

import { unstable_cache } from "next/cache";
import { getTranslations } from "next-intl/server";
import { CACHE_TAGS } from "@/lib/cache-invalidation";
import { connectDB, mongoose } from "@/lib/db";
import { formatCurrency } from "@/lib/intl/money";
import { getStoreCurrency } from "@/lib/intl/server-currency";
import {
  describeCouponOffer,
  getStorefrontCoupon,
  isCouponLive,
} from "@/lib/storefront/storefront-coupon";
import { CampaignBanner } from "@/models/campaign-banner.model";
import { vendorCampaignBannersTag } from "./cache";
import {
  campaignBannerAsShown,
  campaignBannerCountdownEnd,
  campaignBannerState,
  toCampaignBanner,
  type CampaignBanner as CampaignBannerView,
  type StorefrontCampaignBanner,
} from "./types";

/**
 * What the storefront reads. The Home page is one cached render shared by
 * every visitor, so this returns EVERY banner that is, or is about to be,
 * live and leaves the per-visitor decision (device, frequency, trigger) to
 * the browser (`pickCampaignBanners`). Cached for a minute and expired by
 * the tag on any dashboard edit.
 */
const MAX_BANNERS_PER_PAGE = 50;

const readActive = (vendorId: string | null) =>
  unstable_cache(
    async (): Promise<CampaignBannerView[]> => {
      await connectDB();
      const docs = await CampaignBanner.find({
        vendorId: vendorId ? new mongoose.Types.ObjectId(vendorId) : null,
        status: "active",
      })
        .sort({ priority: -1, updatedAt: -1 })
        .limit(MAX_BANNERS_PER_PAGE)
        .lean();
      const now = new Date();
      return docs
        .map(toCampaignBanner)
        .filter((banner) => campaignBannerState(banner, now) !== "ended");
    },
    ["storefront-campaign-banners", vendorId ?? "platform"],
    {
      tags: [
        vendorId
          ? vendorCampaignBannersTag(vendorId)
          : CACHE_TAGS.campaignBanners,
      ],
      revalidate: 60,
    },
  )();

/**
 * The browser's copy of each banner. A banner advertising a code that checkout
 * would refuse is dropped, not shown with a dead code; a banner with a signup
 * form keeps its code back until the visitor has signed up.
 */
async function toStorefront(
  stored: CampaignBannerView[],
  locale: string,
): Promise<StorefrontCampaignBanner[]> {
  // A picture-only popup carries no coupon, so a dead one cannot hide it.
  const banners = stored.map(campaignBannerAsShown);
  const needsCoupons = banners.some((banner) => banner.couponCode);
  const [tHome, currency] = needsCoupons
    ? await Promise.all([
        getTranslations({ locale, namespace: "home" }),
        getStoreCurrency(),
      ])
    : [null, null];
  const say = (key: string, fallback: string, values?: Record<string, string>) =>
    tHome?.has(key) ? tHome(key, values) : fallback;
  const money = (value: number) =>
    formatCurrency(value, currency?.code ?? "USD", currency?.locale ?? locale);

  const out: StorefrontCampaignBanner[] = [];
  for (const banner of banners) {
    let couponOffer = "";
    if (banner.couponCode) {
      const coupon = await getStorefrontCoupon(banner.couponCode);
      if (!coupon || !isCouponLive(coupon)) continue;
      couponOffer = describeCouponOffer(coupon, money, say);
    }
    const afterSignup = banner.signup.enabled && Boolean(banner.couponCode);
    out.push({
      id: banner.id,
      type: banner.type,
      priority: banner.priority,
      updatedAt: banner.updatedAt ?? "",
      schedule: banner.schedule,
      content: banner.content,
      couponCode: afterSignup ? "" : banner.couponCode,
      couponOffer,
      couponAfterSignup: afterSignup,
      countdown: {
        enabled: Boolean(campaignBannerCountdownEnd(banner)),
        endsAt: campaignBannerCountdownEnd(banner),
      },
      signup: banner.signup,
      rules: banner.rules,
    });
  }
  return out;
}

/** The marketplace's own banners, for the Home page. */
export async function getStorefrontCampaignBanners(
  locale: string,
): Promise<StorefrontCampaignBanner[]> {
  try {
    return await toStorefront(await readActive(null), locale);
  } catch (error) {
    // A promotion is never worth a broken Home page.
    console.error("Campaign banners could not be read:", error);
    return [];
  }
}

/** One vendor's banners, for their own store page. */
export async function getVendorStorefrontCampaignBanners(
  vendorId: string,
  locale: string,
): Promise<StorefrontCampaignBanner[]> {
  if (!mongoose.isValidObjectId(vendorId)) return [];
  try {
    return await toStorefront(await readActive(vendorId), locale);
  } catch (error) {
    console.error("Campaign banners could not be read:", error);
    return [];
  }
}
