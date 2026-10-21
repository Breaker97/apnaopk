import type { ComponentProps } from "react";
import { getStorefrontCardRadius } from "@/lib/campaign-banners/theme-radius";
import { CampaignBannerForm } from "./campaign-banner-form";

/**
 * The editor page's server half: reads the store theme's card radius, which
 * the live preview needs to draw the popup's corners the way the shop does.
 * The admin, staff and vendor pages render this, not the form.
 */
export async function CampaignBannerEditor(
  props: Omit<ComponentProps<typeof CampaignBannerForm>, "themeRadius">,
) {
  const themeRadius = await getStorefrontCardRadius();
  return <CampaignBannerForm {...props} themeRadius={themeRadius} />;
}
