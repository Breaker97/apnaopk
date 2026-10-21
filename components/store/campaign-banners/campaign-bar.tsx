"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { StorefrontCampaignBanner } from "@/lib/campaign-banners/types";
import { cn } from "@/lib/utils";
import {
  CampaignBannerCountdown,
  CampaignBannerCoupon,
  CampaignBannerCta,
  campaignBannerColors,
} from "./campaign-banner-parts";

/**
 * The bar shell. A top bar sits in the page's flow, just under the header; a
 * bottom bar floats above the phone's bottom navigation (and the floating
 * buttons: its right edge is kept clear of them).
 *
 * `inPreview` draws it in place, for the dashboard's live preview.
 */
export function CampaignBar({
  banner,
  onDismiss,
  inPreview = false,
}: {
  banner: StorefrontCampaignBanner;
  onDismiss: () => void;
  inPreview?: boolean;
}) {
  const tCommon = useTranslations("common");
  const { content } = banner;
  const bottom = content.barPosition === "bottom";

  return (
    <div
      role="region"
      aria-label={content.headline || undefined}
      data-campaign-bar={bottom ? "bottom" : "top"}
      className={cn(
        "w-full",
        !content.backgroundColor && "bg-primary",
        !content.textColor && "text-primary-foreground",
        bottom && !inPreview
          ? "fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-[39] shadow-[0_-4px_16px_rgba(0,0,0,0.12)] xl:bottom-0"
          : "relative z-30",
      )}
      style={campaignBannerColors(content)}
    >
      <div
        className={cn(
          "mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 text-sm",
          // Keeps the close button clear of the floating buttons on the right
          // (the assistant sits 72px from the edge on a phone, 80px from `sm`
          // up), with a little air between them.
          bottom && !inPreview && "pe-[5.5rem] sm:pe-24",
        )}
      >
        {/* The message wraps; the close button stays beside it rather than
            dropping onto a row of its own on a phone. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-x-4 gap-y-2">
          {content.headline ? (
            <span className="font-semibold">{content.headline}</span>
          ) : null}
          {content.body ? <span className="opacity-90">{content.body}</span> : null}
          <CampaignBannerCountdown countdown={banner.countdown} />
          <CampaignBannerCoupon banner={banner} />
          <CampaignBannerCta
            content={content}
            onFollow={onDismiss}
            onBar
            className="h-8 px-4 text-xs"
          />
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={tCommon("close")}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
