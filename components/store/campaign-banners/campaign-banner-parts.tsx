"use client";

import {
  useCallback,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/language/link";
import { CountdownTimer } from "@/components/store/sections/countdown-timer";
import { CouponCodeButton } from "@/components/store/sections/coupon-code-button";
import { useFallbackTranslator } from "@/hooks/use-fallback-translator";
import type {
  CampaignBannerContent,
  CampaignBannerDevice,
  StorefrontCampaignBanner,
} from "@/lib/campaign-banners/types";
import { cn } from "@/lib/utils";

/**
 * The pieces a popup and a bar are both made of. Kept apart from the two
 * shells so the dashboard's live preview draws exactly what the shop does.
 */

/** A phrase from `store.campaignBanner.*`, in English when the language lacks it. */
export function useCampaignBannerText() {
  const t = useTranslations();
  const fallback = useFallbackTranslator(t);
  return (key: string, text: string) =>
    fallback(`store.campaignBanner.${key}`, text);
}

/** The banner's own colours; unset ones fall back to the storefront theme. */
export function campaignBannerColors(content: CampaignBannerContent): CSSProperties {
  return {
    ...(content.backgroundColor ? { backgroundColor: content.backgroundColor } : {}),
    ...(content.textColor ? { color: content.textColor } : {}),
  };
}

/** Desktop and mobile artwork; either alone serves both. */
export function CampaignBannerImage({
  content,
  className,
  style,
  device,
  onNaturalWidth,
}: {
  content: CampaignBannerContent;
  className?: string;
  style?: CSSProperties;
  /** Pick the artwork for this device instead of letting the window decide. */
  device?: CampaignBannerDevice;
  /** Told the picture's own width in pixels once it is known (and again if the artwork changes). */
  onNaturalWidth?: (pixels: number) => void;
}) {
  const desktop = content.imageDesktop || content.imageMobile;
  // A cached picture can finish loading before React attaches `onLoad`.
  const track = useCallback(
    (element: HTMLImageElement | null) => {
      if (element?.complete && element.naturalWidth) onNaturalWidth?.(element.naturalWidth);
    },
    [onNaturalWidth],
  );
  if (!desktop) return null;
  const common = {
    alt: content.imageAlt,
    className: cn("block h-full w-full object-cover", className),
    style,
    draggable: false,
    ref: track,
    onLoad: (event: SyntheticEvent<HTMLImageElement>) =>
      onNaturalWidth?.(event.currentTarget.naturalWidth),
  };
  if (device) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={
          device === "mobile"
            ? content.imageMobile || desktop
            : desktop
        }
        {...common}
      />
    );
  }
  return (
    <picture>
      {content.imageMobile ? (
        <source media="(max-width: 767px)" srcSet={content.imageMobile} />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={desktop} {...common} />
    </picture>
  );
}

/** The button, when the banner has one. Following it counts as dismissing. */
export function CampaignBannerCta({
  content,
  onFollow,
  className,
  onBar = false,
}: {
  content: CampaignBannerContent;
  onFollow?: () => void;
  className?: string;
  /**
   * On a bar the default button is the bar's own colours swapped. The theme
   * button is the same colour as a default bar, so it would be invisible.
   */
  onBar?: boolean;
}) {
  if (!content.ctaLabel || !content.ctaHref) return null;
  const swapped = onBar && !content.buttonColor;
  const barIsCustom = Boolean(content.backgroundColor);
  const style: CSSProperties = {
    ...(content.buttonColor ? { backgroundColor: content.buttonColor } : {}),
    ...(swapped && barIsCustom
      ? { backgroundColor: content.textColor || "currentColor" }
      : {}),
    ...(content.buttonTextColor
      ? { color: content.buttonTextColor }
      : swapped && barIsCustom
        ? { color: content.backgroundColor }
        : {}),
  };
  const classes = cn(
    "inline-flex h-10 shrink-0 items-center justify-center rounded-full px-5 text-sm font-semibold transition-opacity hover:opacity-90",
    !content.buttonColor && !swapped && "bg-primary",
    swapped && !barIsCustom && "bg-primary-foreground",
    !content.buttonTextColor && !swapped && "text-primary-foreground",
    !content.buttonTextColor && swapped && !barIsCustom && "text-primary",
    className,
  );
  if (/^https?:\/\//i.test(content.ctaHref)) {
    return (
      <a
        href={content.ctaHref}
        target="_blank"
        rel="noopener noreferrer"
        className={classes}
        style={style}
        onClick={onFollow}
      >
        {content.ctaLabel}
      </a>
    );
  }
  return (
    <Link href={content.ctaHref} className={classes} style={style} onClick={onFollow}>
      {content.ctaLabel}
    </Link>
  );
}

/** The code with its copy button, and the offer it stands for. */
export function CampaignBannerCoupon({
  banner,
  className,
}: {
  banner: Pick<StorefrontCampaignBanner, "couponCode" | "couponOffer">;
  className?: string;
}) {
  const say = useCampaignBannerText();
  if (!banner.couponCode) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {banner.couponOffer ? (
        <span className="text-sm font-semibold">{banner.couponOffer}</span>
      ) : null}
      <CouponCodeButton
        code={banner.couponCode}
        copyLabel={say("copy", "Copy")}
        copiedLabel={say("copied", "Copied")}
        className="h-9 w-auto px-4 text-xs"
      />
    </div>
  );
}

/** Time left until the offer ends; gone once it has. */
export function CampaignBannerCountdown({
  countdown,
  className,
}: {
  countdown: StorefrontCampaignBanner["countdown"];
  className?: string;
}): ReactNode {
  const t = useTranslations("home");
  const say = useFallbackTranslator(t);
  if (!countdown.enabled || !countdown.endsAt) return null;
  return (
    <CountdownTimer
      endsAt={countdown.endsAt}
      hideWhenExpired
      size="sm"
      className={className}
      labels={{
        days: say("countdownDays", "Days"),
        hours: say("countdownHours", "Hours"),
        minutes: say("countdownMinutes", "Minutes"),
        seconds: say("countdownSeconds", "Seconds"),
      }}
    />
  );
}
