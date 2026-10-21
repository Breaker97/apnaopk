import { revalidateTag } from "next/cache";

/**
 * A vendor's banners are read for one store page, so they carry a per-vendor
 * tag: one vendor's edit never expires another's page.
 */
export const vendorCampaignBannersTag = (vendorId: string) =>
  `vendor-campaign-banners:${vendorId}`;

/** Expire one vendor's cached banners after a change to a live one. */
export function revalidateVendorCampaignBanners(vendorId: string) {
  revalidateTag(vendorCampaignBannersTag(vendorId), { expire: 0 });
}
